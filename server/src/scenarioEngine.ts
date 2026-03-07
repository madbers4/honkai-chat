import { v4 as uuidv4 } from 'uuid';
import type {
  Scenario,
  ScenarioStep,
  ScenarioAction,
  ChatMessage,
  ChoiceStep,
  ChoiceOption,
  MessageStep,
  ActionStep,
  TransformCharacterStep,
  SwitchGuestModeStep,
  BranchStep,
} from '@honkai-chat/shared';
import { timing } from '@honkai-chat/shared';
import { getState, addMessage } from './state.js';
import { broadcastAll, broadcastToRole, broadcastToCharacterId } from './broadcast.js';
import {
  transformCharacter as doTransformCharacter,
  getCharactersRecord,
} from './characters.js';

const messageGap = 350;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateTypingDelay(value: string, explicitDelay?: number): number {
  if (explicitDelay !== undefined) return explicitDelay;
  return Math.min(
    timing.typingDelayBase + value.length * timing.typingDelayPerChar,
    timing.typingDelayMax,
  );
}

async function processMessageAction(
  characterId: string,
  messageType: string,
  value: string,
  explicitDelay?: number,
): Promise<void> {
  // Typing ON
  broadcastAll({ type: 'typing', characterId, isTyping: true });

  // Wait
  const typingMs = calculateTypingDelay(value, explicitDelay);
  await delay(typingMs);

  // Typing OFF
  broadcastAll({ type: 'typing', characterId, isTyping: false });

  // Create and broadcast message
  const msg: ChatMessage = {
    id: uuidv4(),
    characterId,
    type: messageType as ChatMessage['type'],
    value,
    timestamp: Date.now(),
  };
  addMessage(msg);
  broadcastAll({ type: 'newMessage', message: msg });

  // Pause after message so the next typing indicator doesn't fire instantly
  await delay(messageGap);
}

async function processActionAction(value: string): Promise<void> {
  const msg: ChatMessage = {
    id: uuidv4(),
    characterId: 'system',
    type: 'action',
    value,
    timestamp: Date.now(),
  };
  addMessage(msg);
  broadcastAll({ type: 'newMessage', message: msg });

  // Pause after action so subsequent steps don't overlap
  await delay(messageGap);
}

async function executeActions(actions: ScenarioAction[]): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case 'message':
        await processMessageAction(
          action.characterId,
          action.messageType,
          action.value,
          action.delay,
        );
        break;
      case 'action':
        await processActionAction(action.value);
        break;
      case 'delay':
        await delay(action.ms);
        break;
    }
  }
}

export class ScenarioEngine {
  private scenario: Scenario | null = null;
  private stepIndex: number = 0;
  private isProcessing: boolean = false;
  private lastChoiceOptionId: string | null = null;

  loadScenario(scenario: Scenario): void {
    this.scenario = scenario;
    this.stepIndex = 0;
    this.isProcessing = false;
    this.lastChoiceOptionId = null;
  }

  async processNextStep(): Promise<void> {
    if (!this.scenario) return;
    if (this.isProcessing) return;
    if (this.stepIndex >= this.scenario.steps.length) return;

    this.isProcessing = true;
    const state = getState();

    try {
      await this.processStep(this.scenario.steps[this.stepIndex]);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processStep(step: ScenarioStep): Promise<void> {
    const state = getState();

    switch (step.type) {
      case 'message':
        await this.processMessageStep(step);
        break;
      case 'choice':
        await this.processChoiceStep(step);
        return; // DON'T advance — wait for handleChoiceSelect
      case 'action':
        await this.processActionStep(step);
        break;
      case 'transformCharacter':
        await this.processTransformStep(step);
        break;
      case 'switchGuestMode':
        await this.processSwitchGuestModeStep(step);
        break;
      case 'branch':
        await this.processBranchStep(step);
        break;
    }

    // Advance to next step
    this.stepIndex++;
    state.scenarioIndex = this.stepIndex;

    // Auto-process next step if not a choice
    if (this.scenario && this.stepIndex < this.scenario.steps.length) {
      this.isProcessing = false;
      await this.processNextStep();
    }
  }

  private async processMessageStep(step: MessageStep): Promise<void> {
    await processMessageAction(
      step.characterId,
      step.messageType,
      step.value,
      step.delay,
    );
  }

  private async processChoiceStep(step: ChoiceStep): Promise<void> {
    const state = getState();

    // Store pending choice
    state.pendingChoice = {
      stepIndex: this.stepIndex,
      target: step.target,
      targetCharacterId: step.targetCharacterId,
      options: step.options.map((o: ChoiceOption) => ({ id: o.id, label: o.label })),
    };

    // Send choices to target role (or specific character if targetCharacterId set)
    const choicesMsg = {
      type: 'choices' as const,
      stepIndex: this.stepIndex,
      options: state.pendingChoice.options,
    };

    if (step.targetCharacterId) {
      broadcastToCharacterId(step.targetCharacterId, choicesMsg);
    } else {
      broadcastToRole(step.target, choicesMsg);
    }
  }

  async handleChoiceSelect(optionId: string, stepIndex: number): Promise<void> {
    const state = getState();

    if (!state.pendingChoice) {
      console.warn('[scenarioEngine] handleChoiceSelect: no pending choice');
      return;
    }

    if (state.pendingChoice.stepIndex !== stepIndex) {
      console.warn('[scenarioEngine] handleChoiceSelect: stepIndex mismatch');
      return;
    }

    const pending = state.pendingChoice;
    state.pendingChoice = null;

    // Dismiss choices for all
    broadcastAll({ type: 'choicesDismissed' });

    // Store choice in branch context
    state.branchContext.set(optionId, optionId);
    this.lastChoiceOptionId = optionId;

    // Find the chosen option and execute its actions
    if (!this.scenario) return;
    const currentStep = this.scenario.steps[this.stepIndex] as ChoiceStep;
    const chosenOption = currentStep.options.find((o: ChoiceOption) => o.id === optionId);

    if (chosenOption && chosenOption.actions.length > 0) {
      await executeActions(chosenOption.actions);
    }

    // Advance to next step
    this.stepIndex++;
    state.scenarioIndex = this.stepIndex;

    // Continue processing
    if (this.stepIndex < this.scenario.steps.length) {
      await this.processNextStep();
    }
  }

  private async processActionStep(step: ActionStep): Promise<void> {
    await processActionAction(step.value);
  }

  private async processTransformStep(step: TransformCharacterStep): Promise<void> {
    const state = getState();

    doTransformCharacter(step.fromId, step.toId, step.newName, step.newAvatarUrl);

    // Broadcast transform to all clients
    broadcastAll({
      type: 'characterTransform',
      fromId: step.fromId,
      toId: step.toId,
      newName: step.newName,
      newAvatarUrl: step.newAvatarUrl,
    });

    // Update sessions that were using fromId to use toId
    for (const [, session] of state.sessions) {
      if (session.characterId === step.fromId) {
        session.characterId = step.toId;
      }
    }
  }

  private async processSwitchGuestModeStep(step: SwitchGuestModeStep): Promise<void> {
    const state = getState();
    state.guestMode = step.mode;
    broadcastAll({ type: 'guestModeSwitch', mode: step.mode });
  }

  private async processBranchStep(step: BranchStep): Promise<void> {
    // Find the last choice option from branchContext
    let matchingBranch: ScenarioStep[] | null = null;

    for (const branchKey of Object.keys(step.branches)) {
      if (this.lastChoiceOptionId === branchKey || getState().branchContext.has(branchKey)) {
        matchingBranch = step.branches[branchKey]!;
        break;
      }
    }

    if (!matchingBranch) {
      console.warn('[scenarioEngine] processBranchStep: no matching branch found');
      return;
    }

    // Execute all steps in the branch sequentially
    for (const branchStep of matchingBranch) {
      await this.executeBranchStep(branchStep);
    }
  }

  private async executeBranchStep(step: ScenarioStep): Promise<void> {
    switch (step.type) {
      case 'message':
        await processMessageAction(
          step.characterId,
          step.messageType,
          step.value,
          step.delay,
        );
        break;
      case 'action':
        await processActionAction(step.value);
        break;
      case 'transformCharacter':
        await this.processTransformStep(step);
        break;
      case 'switchGuestMode':
        await this.processSwitchGuestModeStep(step);
        break;
      case 'choice':
        // Nested choices in branches — handle same as top-level
        await this.processChoiceStep(step);
        break;
      case 'branch':
        await this.processBranchStep(step);
        break;
    }
  }

  reset(): void {
    this.stepIndex = 0;
    this.isProcessing = false;
    this.lastChoiceOptionId = null;
    const state = getState();
    state.scenarioIndex = 0;
  }

  getCurrentStepIndex(): number {
    return this.stepIndex;
  }
}

// Singleton engine instance
export const scenarioEngine = new ScenarioEngine();

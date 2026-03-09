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
import { broadcastAll } from './broadcast.js';
import {
  transformCharacter as doTransformCharacter,
  getCharactersRecord,
} from './characters.js';

const messageGap = 350;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function calculateTypingDelay(_value: string, _explicitDelay?: number): number {
  return 0;
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
  private advanceConfirmed: boolean = false;
  /** Full options (with actions) for the currently pending choice */
  private pendingChoiceFullOptions: ChoiceOption[] | null = null;
  /** Remaining branch steps to execute after a nested choice is resolved */
  private branchContinuation: ScenarioStep[] | null = null;

  loadScenario(scenario: Scenario): void {
    this.scenario = scenario;
    this.stepIndex = 0;
    this.isProcessing = false;
    this.lastChoiceOptionId = null;
    this.advanceConfirmed = false;
    this.pendingChoiceFullOptions = null;
    this.branchContinuation = null;
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

  /** Initial scenario start — auto-confirms the first action step */
  async startScenario(): Promise<void> {
    this.advanceConfirmed = true;
    await this.processNextStep();
  }

  /** Called when actor confirms a pending action advance */
  async handleAdvance(): Promise<void> {
    const state = getState();
    if (!state.pendingAdvance) return;

    state.pendingAdvance = null;
    broadcastAll({ type: 'pendingAdvanceDismissed' });

    this.advanceConfirmed = true;
    await this.processNextStep();
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
        if (step.target && !this.advanceConfirmed) {
          // Pause — only when target is explicitly set
          const target = step.target;
          const targetCharId = target === 'actor'
            ? (step.targetCharacterId ?? this.findNextCharacterId())
            : 'system';
          state.pendingAdvance = { target, characterId: targetCharId, actionText: step.value };
          broadcastAll({
            type: 'pendingAdvance',
            target,
            characterId: targetCharId,
            actionText: step.value,
          });
          return; // DON'T advance — wait for handleAdvance
        }
        this.advanceConfirmed = false;
        await this.processActionStep(step);
        break;
      case 'transformCharacter':
        await this.processTransformStep(step);
        break;
      case 'switchGuestMode':
        await this.processSwitchGuestModeStep(step);
        break;
      case 'branch': {
        const paused = await this.processBranchStep(step);
        if (paused) return; // DON'T advance — wait for handleChoiceSelect
        break;
      }
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

  /** Look ahead from current position to find the next message step's characterId */
  private findNextCharacterId(): string {
    if (!this.scenario) return 'system';
    // Look forward
    for (let i = this.stepIndex + 1; i < this.scenario.steps.length; i++) {
      const s = this.scenario.steps[i];
      if (s.type === 'message') return s.characterId;
    }
    // Fallback: look backward
    for (let i = this.stepIndex - 1; i >= 0; i--) {
      const s = this.scenario.steps[i];
      if (s.type === 'message') return s.characterId;
    }
    return 'system';
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

    // Always resolve target character — explicit or derived from option actions
    const targetCharId = step.targetCharacterId ?? this.deriveCharacterFromOptions(step.options);

    // Store full options for handleChoiceSelect (safe even for nested choices in branches)
    this.pendingChoiceFullOptions = step.options;

    // Store pending choice
    state.pendingChoice = {
      stepIndex: this.stepIndex,
      target: step.target,
      targetCharacterId: targetCharId,
      options: step.options.map((o: ChoiceOption) => ({ id: o.id, label: o.label })),
    };

    // Send choices to ALL clients — visibility is handled client-side
    const choicesMsg = {
      type: 'choices' as const,
      stepIndex: this.stepIndex,
      target: step.target,
      targetCharacterId: targetCharId,
      options: state.pendingChoice.options,
    };

    broadcastAll(choicesMsg);
  }

  /** Derive the acting character from a choice's option actions */
  private deriveCharacterFromOptions(options: ChoiceOption[]): string {
    for (const option of options) {
      for (const action of option.actions) {
        if (action.type === 'message') return action.characterId;
      }
    }
    return 'system';
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

    // Use stored full options — safe even for nested choices in branches
    // where this.stepIndex may point to the parent branch step, not the choice
    const chosenOption = this.pendingChoiceFullOptions?.find((o: ChoiceOption) => o.id === optionId);
    this.pendingChoiceFullOptions = null;

    if (chosenOption && chosenOption.actions.length > 0) {
      await executeActions(chosenOption.actions);
    }

    // If there's a branch continuation (nested choice inside a branch), resume it
    if (this.branchContinuation) {
      const remaining = this.branchContinuation;
      this.branchContinuation = null;

      for (let i = 0; i < remaining.length; i++) {
        const branchStep = remaining[i];
        if (branchStep.type === 'choice') {
          // Another nested choice — store the rest as continuation and pause again
          if (i + 1 < remaining.length) {
            this.branchContinuation = remaining.slice(i + 1);
          }
          await this.processChoiceStep(branchStep);
          return; // Wait for next handleChoiceSelect
        }
        await this.executeBranchStep(branchStep);
      }
    }

    // Advance to next step
    this.stepIndex++;
    state.scenarioIndex = this.stepIndex;

    // Continue processing
    if (this.scenario && this.stepIndex < this.scenario.steps.length) {
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

  /** @returns true if the branch paused on a nested choice */
  private async processBranchStep(step: BranchStep): Promise<boolean> {
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
      return false;
    }

    // Execute all steps in the branch sequentially, pausing if a nested choice is hit
    for (let i = 0; i < matchingBranch.length; i++) {
      const branchStep = matchingBranch[i];
      if (branchStep.type === 'choice') {
        // Store remaining steps as continuation for after choice is resolved
        if (i + 1 < matchingBranch.length) {
          this.branchContinuation = matchingBranch.slice(i + 1);
        }
        await this.processChoiceStep(branchStep);
        return true; // Paused — wait for handleChoiceSelect
      }
      await this.executeBranchStep(branchStep);
    }
    return false;
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
    this.advanceConfirmed = false;
    this.pendingChoiceFullOptions = null;
    this.branchContinuation = null;
    const state = getState();
    state.scenarioIndex = 0;
  }

  getCurrentStepIndex(): number {
    return this.stepIndex;
  }
}

// Singleton engine instance
export const scenarioEngine = new ScenarioEngine();

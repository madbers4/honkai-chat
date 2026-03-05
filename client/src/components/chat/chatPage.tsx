import { ChatProvider } from "../../context/chatContext";
import { ChatInner } from "./chatInner";
import type { Role } from "../../types";

interface Props {
  role: Role;
}

export function ChatPage({ role }: Props) {
  return (
    <ChatProvider role={role}>
      <ChatInner role={role} />
    </ChatProvider>
  );
}

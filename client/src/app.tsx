import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { ChatPage } from "./components/chat/chatPage";
import "./styles/global.css";
import "./styles/chat.css";
import "./styles/admin.css";
import "./styles/animations.css";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/guest" element={<ChatPage role="guest" />} />
        <Route path="/actor" element={<ChatPage role="actor" />} />
        <Route path="/" element={<Navigate to="/guest" />} />
      </Routes>
    </BrowserRouter>
  );
}

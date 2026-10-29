import { useCallback, useEffect, useRef, useState } from "react";
import { sendCommand, type GameCommand, type PlayerGameView } from "../lib/api";

export interface RoomSession {
  roomCode: string;
  token: string;
}

const SESSION_KEY = "bluffstack.session.v1";

export function readSession(): RoomSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RoomSession>;
    if (typeof parsed.roomCode !== "string" || typeof parsed.token !== "string") return null;
    return { roomCode: parsed.roomCode, token: parsed.token };
  } catch {
    return null;
  }
}

export function saveSession(session: RoomSession) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

export function useRoomPolling(session: RoomSession | null) {
  const [view, setView] = useState<PlayerGameView | null>(null);
  const [serverOffset, setServerOffset] = useState(0);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const refresh = useCallback(async (command: GameCommand = { type: "heartbeat" }) => {
    if (!session || inFlight.current) return;
    inFlight.current = true;
    try {
      const response = await sendCommand(session.token, command);
      if (!mounted.current) return;
      setView(response.view);
      setServerOffset(response.serverTime - Date.now());
      setError("");
      setConnected(true);
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof Error ? err.message : "Connection failed.");
      setConnected(false);
    } finally {
      inFlight.current = false;
    }
  }, [session]);

  useEffect(() => {
    mounted.current = true;
    if (!session) {
      setView(null);
      setConnected(false);
      setError("");
      return () => { mounted.current = false; };
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [session, refresh]);

  const act = useCallback(async (command: GameCommand) => {
    if (!session) throw new Error("No active room session.");
    const response = await sendCommand(session.token, command);
    setView(response.view);
    setServerOffset(response.serverTime - Date.now());
    setError("");
    setConnected(true);
    return response.view;
  }, [session]);

  return { view, serverOffset, error, connected, refresh, act };
}

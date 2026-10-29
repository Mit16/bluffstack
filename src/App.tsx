import { useEffect, useMemo, useState } from "react";
import {
  createRoom,
  joinRoom,
  type GameCommand,
  type PlayerGameView,
  type ViewOption,
} from "./lib/api";
import {
  clearSession,
  readSession,
  saveSession,
  useRoomPolling,
  type RoomSession,
} from "./hooks/useRoomPolling";

function App() {
  const [session, setSession] = useState<RoomSession | null>(() => readSession());
  const [name, setName] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [fakeText, setFakeText] = useState("");
  const [viewKey, setViewKey] = useState(0);
  const { view, serverOffset, error, connected, act } = useRoomPolling(session);

  useEffect(() => {
    if (view?.currentRound?.ownSubmission) setFakeText(view.currentRound.ownSubmission);
  }, [view?.roundNumber, view?.currentRound?.ownSubmission]);

  const secondsLeft = useMemo(() => {
    if (!view?.phaseDeadline) return null;
    return Math.max(0, Math.ceil((view.phaseDeadline - (Date.now() + serverOffset)) / 1000));
  }, [view?.phaseDeadline, viewKey, serverOffset]);

  useEffect(() => {
    if (!view?.phaseDeadline) return;
    const timer = window.setInterval(() => setViewKey((v) => v + 1), 250);
    return () => window.clearInterval(timer);
  }, [view?.phaseDeadline]);

  async function enterRoom() {
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 24) {
      setNotice("Use a name between 2 and 24 characters.");
      return;
    }
    if (mode === "join" && !/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/i.test(roomCode.trim())) {
      setNotice("Enter a valid four-character room code.");
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      const response = mode === "create"
        ? await createRoom(cleanName)
        : await joinRoom(roomCode, cleanName, readSession()?.roomCode === roomCode.trim().toUpperCase() ? readSession()?.token : undefined);
      const nextSession = { roomCode: response.roomCode, token: response.token! };
      saveSession(nextSession);
      setSession(nextSession);
      setName(cleanName);
      setNotice("");
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Could not enter the room.");
    } finally {
      setBusy(false);
    }
  }

  async function doAction(command: GameCommand) {
    setBusy(true);
    setNotice("");
    try {
      await act(command);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  function exitRoom() {
    clearSession();
    setSession(null);
    setNotice("");
    setFakeText("");
  }

  const player = view?.players.find((p) => p.id === view.viewerPlayerId);
  const isHost = Boolean(view && view.hostPlayerId === view.viewerPlayerId);

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" onClick={(event) => { event.preventDefault(); if (session) exitRoom(); }}>
          <span className="brand-mark">{">_"}</span> bluffstack
        </a>
        <span className="status">
          <span className={`status-dot ${connected ? "" : "offline"}`} />
          {session ? (connected ? "CONNECTED" : "RECONNECTING") : "DEVELOPER PARTY GAME"}
        </span>
      </header>

      {error && session && <div className="connection-banner" role="status">{error}</div>}
      {notice && <div className="notice-banner" role="alert">{notice}</div>}

      {!session || !view ? (
        <section className="hero">
          <p className="eyebrow">A PARTY GAME FOR DEVELOPERS</p>
          <h1>Sound convincing.<br /><span>Bluff confidently.</span></h1>
          <p className="description">
            Obscure tech terms. Invented definitions. Convince everyone your nonsense belongs in the documentation.
          </p>
          {session && !view ? (
            <div className="panel loading-panel">
              <div className="spinner" />
              <p>Reconnecting to room <strong>{session.roomCode}</strong>…</p>
              <button className="secondary-button" onClick={exitRoom}>Leave this session</button>
            </div>
          ) : (
            <div className="panel entry-panel">
              <div className="mode-switch">
                <button className={mode === "create" ? "selected" : ""} onClick={() => setMode("create")}>Create room</button>
                <button className={mode === "join" ? "selected" : ""} onClick={() => setMode("join")}>Join room</button>
              </div>
              <label className="field-label" htmlFor="player-name">Your display name</label>
              <input id="player-name" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="e.g. Kernel Panic" autoComplete="nickname" />
              {mode === "join" && <>
                <label className="field-label" htmlFor="room-code">Room code</label>
                <input id="room-code" value={roomCode} maxLength={4} onChange={(e) => setRoomCode(e.target.value.toUpperCase())} placeholder="ABCD" autoCapitalize="characters" />
              </>}
              <button className="primary-button full-button" disabled={busy} onClick={() => void enterRoom()}>
                {busy ? "Connecting…" : mode === "create" ? "Create your room →" : "Join the room →"}
              </button>
              <p className="muted small">2–8 players · 5 rounds · No accounts required</p>
            </div>
          )}
        </section>
      ) : (
        <div className="game-layout">
          <aside className="sidebar">
            <div className="room-card">
              <p className="eyebrow">ROOM CODE</p>
              <button className="room-code" onClick={() => { void navigator.clipboard?.writeText(view.roomCode).then(() => setNotice("Room code copied.")).catch(() => setNotice("Room code: " + view.roomCode)); }}>
                {view.roomCode} <span>⧉</span>
              </button>
              <p className="muted small">Share this code with your fellow bluffers.</p>
            </div>
            <div className="players-card">
              <div className="section-heading"><h2>Players</h2><span className="count-pill">{view.players.length}/8</span></div>
              <ul className="player-list">
                {[...view.players].sort((a, b) => a.joinedAt - b.joinedAt).map((p) => (
                  <li key={p.id} className={!p.active ? "player-inactive" : ""}>
                    <span className="avatar">{p.name.trim().slice(0, 1).toUpperCase()}</span>
                    <span className="player-name">{p.name}{p.id === view.viewerPlayerId && <small> YOU</small>}</span>
                    {p.id === view.hostPlayerId && <span className="host-mark" title="Host">★</span>}
                    <strong className="player-score">{p.score}</strong>
                  </li>
                ))}
              </ul>
              <p className="muted tiny">★ Room host · Scores update after each reveal</p>
            </div>
            <button className="quiet-button" onClick={exitRoom}>Leave room</button>
          </aside>

          <section className="main-panel">
            <div className="phase-topline">
              <span className="phase-chip">{view.phase === "LOBBY" ? "WAITING ROOM" : view.phase === "FINISHED" ? "GAME COMPLETE" : `ROUND ${view.roundNumber} / 5`}</span>
              {secondsLeft !== null && view.phase !== "LOBBY" && view.phase !== "FINISHED" && <span className={`timer ${secondsLeft <= 5 ? "urgent" : ""}`}>◷ {secondsLeft}s</span>}
            </div>

            {view.phase === "LOBBY" && <Lobby view={view} isHost={isHost} busy={busy} onStart={() => void doAction({ type: "start" })} />}
            {view.phase === "WRITE" && <WritePhase view={view} value={fakeText} setValue={setFakeText} busy={busy} onSubmit={() => void doAction({ type: "submitFake", roundNumber: view.roundNumber, text: fakeText.trim() })} />}
            {view.phase === "VOTE" && <VotePhase view={view} busy={busy} onVote={(optionId) => void doAction({ type: "submitVote", roundNumber: view.roundNumber, optionId })} />}
            {view.phase === "REVEAL" && <RevealPhase view={view} isHost={isHost} busy={busy} onAdvance={() => void doAction({ type: "advance", roundNumber: view.roundNumber })} />}
            {view.phase === "FINISHED" && <FinishedPhase view={view} isHost={isHost} busy={busy} onPlayAgain={() => void doAction({ type: "playAgain" })} />}
          </section>
        </div>
      )}

      <footer className="footer">
        <span>BLUFFSTACK / 2026</span><span>Built on logic. Won by deception.</span>
      </footer>
    </main>
  );
}

function Lobby({ view, isHost, busy, onStart }: { view: PlayerGameView; isHost: boolean; busy: boolean; onStart: () => void }) {
  return <div className="phase-content">
    <p className="eyebrow">THE CALM BEFORE THE COMMIT</p>
    <h1 className="phase-title">Ready to <span>bluff?</span></h1>
    <p className="description">Everyone gets a real technology term. Write a convincing fake definition, spot the real one, and collect points from anyone who believes you.</p>
    <div className="rule-grid">
      <div><strong>+3</strong><span>Find the real definition</span></div>
      <div><strong>+2</strong><span>Per vote your fake receives</span></div>
      <div><strong>5</strong><span>Rounds of technical nonsense</span></div>
    </div>
    {isHost ? <button className="primary-button" disabled={busy || view.players.filter((p) => p.active).length < 2} onClick={onStart}>Start game →</button>
      : <div className="waiting-note"><div className="spinner" /><span>Waiting for the host to start the game…</span></div>}
    {isHost && view.players.filter((p) => p.active).length < 2 && <p className="muted small">At least two active players are required.</p>}
  </div>;
}

function WritePhase({ view, value, setValue, busy, onSubmit }: { view: PlayerGameView; value: string; setValue: (v: string) => void; busy: boolean; onSubmit: () => void }) {
  const round = view.currentRound;
  return <div className="phase-content">
    <p className="eyebrow">PHASE 01 / WRITE A LIE</p>
    <h1 className="phase-title">Define the <span>undefined.</span></h1>
    <div className="term-card"><span className="term-label">YOUR TECH TERM</span><h2>{round?.term ?? "Loading term…"}</h2><p>Invent a definition that sounds real enough to fool another developer.</p></div>
    {round?.hasSubmitted ? <div className="submitted-card"><span className="success-icon">✓</span><div><strong>Definition submitted</strong><p className="muted">{round.ownSubmission || "Your fake is locked in."}</p><p className="small muted">Waiting for everyone else. Keep your poker face compiling.</p></div></div> :
      <div className="form-stack">
        <label className="field-label" htmlFor="fake-definition">Your fake definition</label>
        <textarea id="fake-definition" value={value} maxLength={1000} onChange={(e) => setValue(e.target.value)} rows={5} placeholder="A protocol that optimizes…" />
        <div className="input-meta"><span>Make it plausible. Or at least confidently obscure.</span><span>{value.length}/1000</span></div>
        <button className="primary-button" disabled={busy || value.trim().length === 0} onClick={onSubmit}>Submit definition →</button>
      </div>}
  </div>;
}

function VotePhase({ view, busy, onVote }: { view: PlayerGameView; busy: boolean; onVote: (id: string) => void }) {
  const round = view.currentRound;
  return <div className="phase-content">
    <p className="eyebrow">PHASE 02 / PICK THE TRUTH</p>
    <h1 className="phase-title">Which one <span>is real?</span></h1>
    <p className="description">Term: <strong>{round?.term}</strong>. Choose the genuine definition. You can't vote for your own fake.</p>
    {round?.ownVoteOptionId ? <div className="submitted-card"><span className="success-icon">✓</span><div><strong>Vote locked in</strong><p className="muted">Waiting for the reveal…</p></div></div> :
      <div className="option-list">{(round?.options ?? []).map((option, index) => <button key={option.id} className="option-button" disabled={busy} onClick={() => onVote(option.id)}><span className="option-letter">{String.fromCharCode(65 + index)}</span><span>{option.text}</span><span className="option-arrow">↗</span></button>)}</div>}
  </div>;
}

function RevealPhase({ view, isHost, busy, onAdvance }: { view: PlayerGameView; isHost: boolean; busy: boolean; onAdvance: () => void }) {
  const round = view.currentRound;
  const options = round?.options ?? [];
  const votes = round?.votes ?? {};
  const voteCounts = new Map<string, number>();
  Object.values(votes).forEach((id) => voteCounts.set(id, (voteCounts.get(id) ?? 0) + 1));
  return <div className="phase-content">
    <p className="eyebrow">PHASE 03 / THE TRUTH COMPILES</p>
    <h1 className="phase-title">The <span>reveal.</span></h1>
    <div className="term-card"><span className="term-label">REAL DEFINITION</span><h2>{round?.term}</h2><p>{round?.realDefinition}</p>{round?.sourceUrl && <a href={round.sourceUrl} target="_blank" rel="noreferrer">Read the source ↗</a>}</div>
    <div className="option-list reveal-list">{options.map((option, index) => <div key={option.id} className={`reveal-option ${option.isReal ? "is-real" : ""}`}><span className="option-letter">{String.fromCharCode(65 + index)}</span><div className="reveal-option-copy"><p>{option.text}</p><small>{option.isReal ? "✓ REAL DEFINITION" : `FAKE BY ${view.players.find((p) => p.id === option.authorPlayerId)?.name ?? "PLAYER"}`}</small></div><span className="vote-count">{voteCounts.get(option.id) ?? 0} votes</span></div>)}</div>
    {isHost ? <button className="primary-button" disabled={busy} onClick={onAdvance}>{view.roundNumber >= 5 ? "See final scores →" : "Next round →"}</button> : <div className="waiting-note"><div className="spinner" /><span>Host is reviewing the evidence…</span></div>}
  </div>;
}

function FinishedPhase({ view, isHost, busy, onPlayAgain }: { view: PlayerGameView; isHost: boolean; busy: boolean; onPlayAgain: () => void }) {
  const leaderboard = [...view.players].sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt);
  const winners = leaderboard.length ? leaderboard.filter((p) => p.score === leaderboard[0].score) : [];
  return <div className="phase-content">
    <p className="eyebrow">BUILD PASSED / GAME COMPLETE</p>
    <h1 className="phase-title">{winners.length === 1 ? <>{winners[0]?.name} <span>wins.</span></> : <>A tie. <span>Beautiful chaos.</span></>}</h1>
    <p className="description">Five rounds of bluffing, bluff detection, and suspiciously confident technical explanations.</p>
    <div className="leaderboard">{leaderboard.map((p, index) => <div className={`leader-row ${index === 0 ? "leader-first" : ""}`} key={p.id}><span className="leader-rank">{index === 0 ? "♛" : `0${index + 1}`}</span><span className="leader-name">{p.name}{p.id === view.viewerPlayerId ? " (you)" : ""}</span><strong>{p.score} pts</strong></div>)}</div>
    {isHost && <button className="primary-button" disabled={busy} onClick={onPlayAgain}>Play again →</button>}
    {!isHost && <p className="muted small">Waiting for the host to start another game.</p>}
    <div className="history-list"><h2>Round history</h2>{view.history.map((r) => <details key={r.roundNumber}><summary>Round {r.roundNumber}: {r.term}</summary><p>{r.realDefinition}</p></details>)}</div>
  </div>;
}

export default App;

function App() {
    return (
        <main className="app-shell">
            <header className="topbar">
                <a className="brand" href="/" aria-label="Bluffstack home">
                    <span className="brand-mark">{">_"}</span>
                    bluffstack
                </a>
                <span className="status">
                    <span className="status-dot" />
                    DEVELOPMENT
                </span>
            </header>

            <section className="hero">
                <p className="eyebrow">A PARTY GAME FOR DEVELOPERS</p>

                <h1>
                    Sound convincing.
                    <br />
                    <span>Bluff confidently.</span>
                </h1>

                <p className="description">
                    Obscure tech terms. Invented definitions. Eight developers
                    convinced they know more than everyone else.
                </p>

                <div className="actions">
                    <button className="primary-button" disabled>
                        Create a room
                    </button>
                    <button className="secondary-button" disabled>
                        Join a room
                    </button>
                </div>

                <p className="notice">
                    Game services are not connected yet. Multiplayer functionality
                    comes next.
                </p>
            </section>

            <footer className="footer">
                <span>BLUFFSTACK / 2026</span>
                <span>Built on logic. Won by deception.</span>
            </footer>
        </main>
    );
}

export default App;
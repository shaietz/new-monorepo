import { useState } from "react";

function App() {
  const [open, setOpen] = useState(false);

  return (
    <main>
      <h1>client</h1>
      <button type="button" onClick={() => setOpen((current) => !current)}>
        {open ? "Hide details" : "Show details"}
      </button>
      {open ? <p>Replace this with the app.</p> : null}
    </main>
  );
}

export default App;

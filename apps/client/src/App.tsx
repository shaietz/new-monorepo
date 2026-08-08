import { useState } from "react";
import { getConfig } from "./config.ts";

function App() {
  const [open, setOpen] = useState(false);
  const { API_URL } = getConfig();

  return (
    <main>
      <h1>client</h1>
      <button type="button" onClick={() => setOpen((current) => !current)}>
        {open ? "Hide details" : "Show details"}
      </button>
      {open ? <p>API: {API_URL || "(not configured)"}</p> : null}
    </main>
  );
}

export default App;

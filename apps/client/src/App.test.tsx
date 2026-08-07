import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "client" })).toBeInTheDocument();
  });

  it("toggles the details on click", async () => {
    render(<App />);
    expect(screen.queryByText("Replace this with the app.")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show details" }));

    expect(screen.getByText("Replace this with the app.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide details" })).toBeInTheDocument();
  });
});

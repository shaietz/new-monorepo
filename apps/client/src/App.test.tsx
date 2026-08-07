import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import App from "./App";

describe("App", () => {
  it("renders the heading", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Get started" })).toBeInTheDocument();
  });

  it("increments the counter on click", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /count is /i }));
    expect(screen.getByRole("button", { name: /count is 1/i })).toBeInTheDocument();
  });
});

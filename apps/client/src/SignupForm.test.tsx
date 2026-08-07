import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { SignupForm } from "./SignupForm";

describe("SignupForm", () => {
  it("reports errors from the shared schema", async () => {
    render(<SignupForm />);

    await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: "Sign up" }));

    const alerts = await screen.findAllByRole("alert");
    expect(alerts.length).toBeGreaterThan(0);
  });

  it("accepts input the shared schema considers valid", async () => {
    render(<SignupForm />);

    await userEvent.type(screen.getByLabelText("Display name"), "Ada");
    await userEvent.type(screen.getByLabelText("Email"), "ada@example.dev");
    await userEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByText("Looks good.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import { CreateUserSchema, UserSchema, createUserErrors } from "./index.ts";

describe("UserSchema", () => {
  it("accepts a well-formed user", () => {
    const user = {
      id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
      email: "user@example.dev",
      displayName: "Ada",
    };

    expect(UserSchema.parse(user)).toEqual(user);
  });

  it("rejects a non-uuid id", () => {
    const result = UserSchema.safeParse({
      id: "not-a-uuid",
      email: "user@example.dev",
      displayName: "Ada",
    });

    expect(result.success).toBe(false);
  });
});

describe("CreateUserSchema", () => {
  it("has no id field", () => {
    expect(Object.keys(CreateUserSchema.shape)).toEqual(["email", "displayName"]);
  });

  it("trims the display name", () => {
    const parsed = CreateUserSchema.parse({ email: "a@b.dev", displayName: "  Ada  " });

    expect(parsed.displayName).toBe("Ada");
  });
});

describe("createUserErrors", () => {
  it("returns undefined when valid", () => {
    expect(createUserErrors({ email: "a@b.dev", displayName: "Ada" })).toBeUndefined();
  });

  it("keys messages by field", () => {
    const errors = createUserErrors({ email: "nope", displayName: "" });

    expect(errors).toBeDefined();
    expect(errors?.email).toBeTruthy();
    expect(errors?.displayName).toBeTruthy();
  });

  it("reports only the fields that failed", () => {
    const errors = createUserErrors({ email: "nope", displayName: "Ada" });

    expect(errors?.email).toBeTruthy();
    expect(errors?.displayName).toBeUndefined();
  });
});

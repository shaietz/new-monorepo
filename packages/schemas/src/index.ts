import { z } from "zod";

/** @public — shared between client and server; no consumer inside this package. */
export const UserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().trim().min(1).max(80),
});

/** @public — for consumers typing user data; not referenced inside this package. */
export type User = z.infer<typeof UserSchema>;

/** @public — request body on the server, form shape on the client. */
export const CreateUserSchema = UserSchema.omit({ id: true });

/** @public */
export type CreateUser = z.infer<typeof CreateUserSchema>;

/** @public — field-keyed errors for rendering next to form inputs. */
export function createUserErrors(
  input: unknown,
): Partial<Record<keyof CreateUser, string>> | undefined {
  const result = CreateUserSchema.safeParse(input);
  if (result.success) return undefined;

  const errors: Partial<Record<keyof CreateUser, string>> = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in errors)) {
      errors[field as keyof CreateUser] = issue.message;
    }
  }

  return errors;
}

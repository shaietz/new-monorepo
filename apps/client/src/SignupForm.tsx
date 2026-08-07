import { useState } from "react";
import { createUserErrors, type CreateUser } from "@repo/schemas";

/**
 * Validates with the same schema the server uses for `POST /users`, so the
 * client can't disagree with the API about what a valid user is.
 */
export function SignupForm() {
  const [values, setValues] = useState<CreateUser>({ email: "", displayName: "" });
  const [errors, setErrors] = useState<ReturnType<typeof createUserErrors>>();
  const [accepted, setAccepted] = useState(false);

  const update = (field: keyof CreateUser) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setValues((current) => ({ ...current, [field]: event.target.value }));
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const found = createUserErrors(values);
        setErrors(found);
        setAccepted(!found);
      }}
    >
      <label htmlFor="displayName">Display name</label>
      <input id="displayName" value={values.displayName} onChange={update("displayName")} />
      {errors?.displayName ? <p role="alert">{errors.displayName}</p> : null}

      <label htmlFor="email">Email</label>
      <input id="email" value={values.email} onChange={update("email")} />
      {errors?.email ? <p role="alert">{errors.email}</p> : null}

      <button type="submit">Sign up</button>
      {accepted ? <p>Looks good.</p> : null}
    </form>
  );
}

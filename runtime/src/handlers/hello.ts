import { os } from "../implementation";

export const hello = os.hello.handler(({ input }) => {
  return {
    message: `Hello, ${input.name}!`,
  };
});

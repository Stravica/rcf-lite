import { greet } from '@ws/lib';

// The api's own code (round F, F-9): it reaches the workspace library by
// name, through the rcf project root's node_modules.
export function welcome(name) {
  return `${greet(name)}, welcome`;
}

import { buildDescribe } from '../spec.js';

/** describe 刻意不开库：库损坏时它仍要能用（PRD 5.2.14、AC-7）。 */
export function runDescribe(): unknown {
  return buildDescribe();
}

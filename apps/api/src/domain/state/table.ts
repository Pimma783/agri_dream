// Table-driven transition helper. Pure: no I/O, no clock.
export type TransitionError = {
  readonly code: 'INVALID_TRANSITION';
  readonly machine: string;
  readonly from: string;
  readonly event: string;
};

export type TransitionResult<S extends string> =
  | { readonly ok: true; readonly state: S }
  | { readonly ok: false; readonly error: TransitionError };

export type TransitionTable<S extends string, E extends string> = {
  readonly [From in S]: { readonly [Ev in E]?: S };
};

export function makeNext<S extends string, E extends string>(
  machine: string,
  table: TransitionTable<S, E>,
): (state: S, event: E) => TransitionResult<S> {
  return (state, event) => {
    const to = table[state]?.[event];
    if (to === undefined) {
      return { ok: false, error: { code: 'INVALID_TRANSITION', machine, from: state, event } };
    }
    return { ok: true, state: to };
  };
}

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { readPref, writePref } from '../storage';

// State that survives reloads (localStorage, versioned key).
export function usePersistentState<T>(name: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [val, setVal] = useState<T>(() => readPref(name, initial));
  useEffect(() => writePref(name, val), [name, val]);
  return [val, setVal];
}

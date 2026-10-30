import { Fragment, type ReactNode } from 'react';

// Renders the catalogues' light inline markup — **strong**, _em_, `code` —
// so translated sentences can keep their emphasis without embedding JSX.
const TOKEN = /(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g;

export function Rich({ text }: { text: string }): ReactNode {
  return text.split(TOKEN).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4)
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return <code key={i}>{part.slice(1, -1)}</code>;
    if (part.startsWith('_') && part.endsWith('_') && part.length > 2)
      return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

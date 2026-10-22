import { parseArticleBody, type Block, type Inline } from '@nona/contracts';
import { Fragment, type ReactNode } from 'react';

/**
 * Renders the safe Markdown subset as React elements. Text is never injected as HTML, and links/images
 * were already vetted by the shared parser, so there is no raw-HTML path at all.
 */
function inline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    if (n.t === 'text') return <Fragment key={i}>{n.text}</Fragment>;
    if (n.t === 'bold') return <strong key={i}>{inline(n.children)}</strong>;
    if (n.t === 'italic') return <em key={i}>{inline(n.children)}</em>;
    const external = n.href.startsWith('https://');
    return (
      <a
        key={i}
        href={n.href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {inline(n.children)}
      </a>
    );
  });
}

function block(b: Block, i: number): ReactNode {
  switch (b.t) {
    case 'heading':
      return b.level === 2 ? (
        <h2 key={i}>{inline(b.children)}</h2>
      ) : (
        <h3 key={i}>{inline(b.children)}</h3>
      );
    case 'paragraph':
      return <p key={i}>{inline(b.children)}</p>;
    case 'quote':
      return <blockquote key={i}>{inline(b.children)}</blockquote>;
    case 'rule':
      return <hr key={i} />;
    case 'image':
      return (
        <figure key={i}>
          <img src={b.src} alt={b.alt} loading="lazy" />
          {b.alt && <figcaption>{b.alt}</figcaption>}
        </figure>
      );
    case 'list': {
      const items = b.items.map((it, j) => <li key={j}>{inline(it)}</li>);
      return b.ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
    }
  }
}

export function ArticleBody({ body }: { body: string }) {
  return <div className="article-body">{parseArticleBody(body).map(block)}</div>;
}

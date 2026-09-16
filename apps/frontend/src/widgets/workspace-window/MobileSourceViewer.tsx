import { useEffect, useRef, useState } from 'react';
import { createHighlighterCore, type LanguageInput } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import githubLight from '@shikijs/themes/github-light';
import type { SourceRendererProps } from './DesktopSourceViewer';
import styles from './WorkspaceContent.module.css';

const languageLoaders: Record<string, () => Promise<{ default: LanguageInput }>> = {
  c: () => import('@shikijs/langs/c'),
  cpp: () => import('@shikijs/langs/cpp'),
  csharp: () => import('@shikijs/langs/csharp'),
  css: () => import('@shikijs/langs/css'),
  go: () => import('@shikijs/langs/go'),
  graphql: () => import('@shikijs/langs/graphql'),
  html: () => import('@shikijs/langs/html'),
  ini: () => import('@shikijs/langs/ini'),
  java: () => import('@shikijs/langs/java'),
  javascript: () => import('@shikijs/langs/javascript'),
  json: () => import('@shikijs/langs/json'),
  kotlin: () => import('@shikijs/langs/kotlin'),
  lua: () => import('@shikijs/langs/lua'),
  markdown: () => import('@shikijs/langs/markdown'),
  php: () => import('@shikijs/langs/php'),
  powershell: () => import('@shikijs/langs/powershell'),
  python: () => import('@shikijs/langs/python'),
  ruby: () => import('@shikijs/langs/ruby'),
  rust: () => import('@shikijs/langs/rust'),
  shell: () => import('@shikijs/langs/shellscript'),
  sql: () => import('@shikijs/langs/sql'),
  swift: () => import('@shikijs/langs/swift'),
  typescript: () => import('@shikijs/langs/typescript'),
  xml: () => import('@shikijs/langs/xml'),
  yaml: () => import('@shikijs/langs/yaml'),
};

const highlightedHtml = async (text: string, language: string) => {
  const loader = languageLoaders[language];
  if (!loader) return '';
  const grammar = (await loader()).default;
  const highlighter = await createHighlighterCore({
    themes: [githubLight],
    langs: [grammar],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter.codeToHtml(text, { lang: language, theme: 'github-light' });
};

const MobileSourceViewer = ({ text, language, label, wrap, line }: SourceRendererProps) => {
  const [html, setHtml] = useState<string>();
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!line || !host.current) return;
    const lines = host.current.querySelectorAll<HTMLElement>('.line');
    const target = lines[Math.min(line, lines.length) - 1];
    if (target) { target.style.backgroundColor = '#fff0bb'; target.scrollIntoView({block: 'center'}); }
    return () => { if (target) target.style.backgroundColor = ''; };
  }, [html, line]);

  useEffect(() => {
    let active = true;
    setHtml(undefined);
    highlightedHtml(text, language)
      .then(value => { if (active) setHtml(value); })
      .catch(() => { if (active) setHtml(''); });
    return () => { active = false; };
  }, [language, text]);

  if (html === undefined) return <div className={styles.sourceLoading}>Highlighting source…</div>;
  if (!html) return <div ref={host}><pre className={`${styles.plainSource} ${wrap ? styles.wrapped : ''}`} aria-label={`${label} source`}>{text.split('\n').map((content, index) => <span key={index} className="line">{content}{'\n'}</span>)}</pre></div>;
  return <div ref={host} className={`${styles.shikiSource} ${wrap ? styles.wrapped : ''}`} aria-label={`${label} source`} dangerouslySetInnerHTML={{ __html: html }} />;
};

export default MobileSourceViewer;

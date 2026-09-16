import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';
import styles from './WorkspaceContent.module.css';

export type SourceRendererProps = {
  text: string;
  language: string;
  label: string;
  wrap: boolean;
  line?: number;
};

const DesktopSourceViewer = ({ text, language, label, wrap, line }: SourceRendererProps) => {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    const model = monaco.editor.createModel(text, language);
    const editor = monaco.editor.create(hostRef.current, {
      model,
      ariaLabel: `${label} source`,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      folding: true,
      lineNumbers: 'on',
      minimap: { enabled: false },
      renderLineHighlight: 'none',
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      wordWrap: wrap ? 'on' : 'off',
      fontFamily: '"Cascadia Code", "JetBrains Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 21,
      padding: { top: 16, bottom: 24 },
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      stickyScroll: { enabled: true },
    });
    if (line) {
      const target = Math.min(line, model.getLineCount());
      editor.setSelection(new monaco.Range(target, 1, target, model.getLineMaxColumn(target)));
      editor.revealLineInCenter(target);
    }
    return () => {
      editor.dispose();
      model.dispose();
    };
  }, [label, language, text, wrap, line]);

  return <div ref={hostRef} className={styles.monacoHost} />;
};

export default DesktopSourceViewer;

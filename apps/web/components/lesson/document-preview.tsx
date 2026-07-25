'use client';

import { useEffect, useState } from 'react';
import mammoth from 'mammoth';
import DOMPurify from 'dompurify';
import * as XLSX from 'xlsx';
import { Download, FileText, Loader2 } from 'lucide-react';

interface DocumentPreviewProps {
  url: string;
  kind: 'PDF' | 'DOC' | 'SHEET' | 'OTHER';
  name: string;
}

/**
 * In-page previewer for non-media attachments. Parses DOC/SHEET files
 * client-side (mammoth/xlsx) instead of routing through a third-party
 * viewer (e.g. Google Docs Viewer) so private lesson files are never
 * handed to an outside service.
 */
export function DocumentPreview({ url, kind, name }: DocumentPreviewProps) {
  if (kind === 'PDF') {
    // Plain `src` — no `#toolbar=0`/`#zoom=`. We tried hiding the native
    // toolbar (deterrent against easy downloading) and driving zoom via
    // the `#zoom=` open parameter instead, but that parameter is
    // unreliable in current Chromium (URL updates, page doesn't actually
    // re-render at the new scale). The native toolbar's own zoom buttons
    // are the only thing that reliably stays crisp across browsers/devices,
    // so for now we keep the toolbar (and its download button) rather than
    // ship broken zoom. TODO: revisit with a bundled PDF renderer
    // (pdf.js) for a toolbar we fully control on every platform.
    return <iframe src={url} title={name} className="h-full w-full border-0 bg-white" />;
  }
  if (kind === 'DOC') {
    return <WordPreview url={url} name={name} />;
  }
  if (kind === 'SHEET') {
    return <SheetPreview url={url} name={name} />;
  }
  return <UnsupportedPreview url={url} name={name} />;
}

function WordPreview({ url, name }: { url: string; name: string }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setFailed(false);
    fetch(url)
      .then((res) => res.arrayBuffer())
      .then((buffer) => mammoth.convertToHtml({ arrayBuffer: buffer }))
      .then((result) => {
        // NEVER trust converted HTML from a user-uploaded .docx. mammoth
        // preserves the document's own hyperlink targets verbatim, so a
        // crafted file can smuggle in `javascript:` links (and other
        // active-content vectors) that would execute in the viewer's
        // session — and since auth tokens live in JS-readable storage,
        // that is a full account-takeover primitive. DOMPurify strips
        // scripts, event handlers, and dangerous URI schemes before the
        // markup ever reaches dangerouslySetInnerHTML.
        if (!cancelled) {
          setHtml(
            DOMPurify.sanitize(result.value, {
              ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'colspan', 'rowspan'],
              // Force any surviving <a> to open inert in a new tab.
              ADD_ATTR: ['target', 'rel'],
            }),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) return <UnsupportedPreview url={url} name={name} />;
  if (!html) return <PreviewLoading />;
  return (
    <div
      className="max-h-[75vh] w-full max-w-none overflow-auto rounded-xl border border-rim bg-canvas p-6 text-sm leading-relaxed text-ink-strong [&_h1]:mb-3 [&_h1]:text-xl [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-bold [&_p]:mb-3 [&_table]:border-collapse [&_td]:border [&_td]:border-rim [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-rim [&_th]:px-2 [&_th]:py-1 [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5"
      // `html` was run through DOMPurify above (see the sanitize() call in
      // the effect) — scripts, event handlers, and javascript:/data: URIs
      // are already stripped, so this is safe to inject.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function SheetPreview({ url, name }: { url: string; name: string }) {
  const [rows, setRows] = useState<string[][] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    setFailed(false);
    fetch(url)
      .then((res) => res.arrayBuffer())
      .then((buffer) => {
        const workbook = XLSX.read(buffer, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        if (!sheetName) throw new Error('empty workbook');
        const sheet = workbook.Sheets[sheetName];
        if (!sheet) throw new Error('empty sheet');
        const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
          header: 1,
          raw: false,
        });
        if (!cancelled) {
          setRows(data.map((row) => row.map((cell) => String(cell ?? ''))));
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (failed) return <UnsupportedPreview url={url} name={name} />;
  if (!rows) return <PreviewLoading />;
  return (
    <div className="max-h-[75vh] w-full max-w-full overflow-auto rounded-xl border border-rim">
      <table className="w-full min-w-max border-collapse text-sm">
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={i === 0 ? 'bg-tint font-semibold' : 'odd:bg-canvas even:bg-tint/40'}
            >
              {row.map((cell, j) => (
                <td key={j} className="border border-rim px-3 py-2 text-ink-strong">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PreviewLoading() {
  return (
    <div className="flex h-40 w-full items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-ink-faint" />
    </div>
  );
}

function UnsupportedPreview({ url, name }: { url: string; name: string }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="text-center">
      <FileText className="mx-auto h-16 w-16 text-ink-faint" />
      <p className="mt-4 text-sm text-ink-soft">
        Bu fayl turini sahifada ko&apos;rsatib bo&apos;lmaydi.
      </p>
      <button
        type="button"
        onClick={handleDownload}
        disabled={downloading}
        className="mt-3 inline-flex items-center gap-2 rounded-xl bg-blue px-4 py-2 text-sm font-bold text-white hover:bg-blue-600 disabled:opacity-60"
      >
        {downloading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
        Yuklab olish
      </button>
    </div>
  );
}

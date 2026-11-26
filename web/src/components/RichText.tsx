import { useEffect, useRef, useState } from 'react';
import { Bold, Highlighter, Image as ImageIcon, Italic, List, ListOrdered, Palette, Paperclip, Underline } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  minHeight?: number;
  className?: string;
}

export function RichTextEditor({ value, onChange, placeholder = '请输入内容…', minHeight = 96, className }: RichTextEditorProps) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const [uploading, setUploading] = useState(false);
  const saveSelection = () => {
    const selection = window.getSelection();
    if (selection?.rangeCount) savedRange.current = selection.getRangeAt(0).cloneRange();
    ref.current?.focus();
  };
  const restoreSelection = () => {
    if (!savedRange.current) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(savedRange.current);
  };
  useEffect(() => {
    if (ref.current && document.activeElement !== ref.current && ref.current.innerHTML !== (value || '')) {
      ref.current.innerHTML = value || '';
    }
  }, [value]);
  const run = (command: string, value?: string) => {
    ref.current?.focus();
    restoreSelection();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(command, false, value);
    if (ref.current) onChange(ref.current.innerHTML);
  };
  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) return toast.error('附件不能超过 50MB');
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const response = await api.post<{ data: { url: string; filename: string; mime_type: string } }>('/api/rich-attachments', form);
      const attachment = response.data;
      const safeName = attachment.filename.replace(/[<>&"]/g, '');
      const html = attachment.mime_type?.startsWith('image/')
        ? `<img src="${attachment.url}" alt="${safeName}" style="max-width:100%" />`
        : `<a href="${attachment.url}" target="_blank" rel="noopener">${safeName}</a>`;
      ref.current?.focus();
      restoreSelection();
      document.execCommand('insertHTML', false, html);
      if (ref.current) onChange(ref.current.innerHTML);
      toast.success('附件已插入');
    } catch (error: any) {
      toast.error(error.message);
    } finally {
      setUploading(false);
    }
  };
  return (
    <div className={cn('min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white focus-within:border-brand-400', className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-100 px-2 py-1">
        {[
          { command: 'bold', icon: Bold, label: '加粗' },
          { command: 'italic', icon: Italic, label: '斜体' },
          { command: 'underline', icon: Underline, label: '下划线' },
          { command: 'insertUnorderedList', icon: List, label: '无序列表' },
          { command: 'insertOrderedList', icon: ListOrdered, label: '有序列表' },
        ].map(({ command, icon: Icon, label }) => (
          <button key={command} type="button" aria-label={label} title={label} onMouseDown={(event) => { event.preventDefault(); run(command); }} className="flex h-6 w-6 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600">
            <Icon className="h-3 w-3" />
          </button>
        ))}
        <label onMouseDown={saveSelection} className="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="文字颜色">
          <Palette className="h-3 w-3" />
          <input type="color" defaultValue="#334155" onChange={(event) => run('foreColor', event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="文字颜色" />
        </label>
        <label onMouseDown={saveSelection} className="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="文字背景颜色">
          <Highlighter className="h-3 w-3" />
          <input type="color" defaultValue="#fef08a" onChange={(event) => run('hiliteColor', event.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="文字背景颜色" />
        </label>
        <label onMouseDown={saveSelection} className="flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 text-[9.5px] text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="上传图片">
          <ImageIcon className="h-3 w-3" /> 图片
          <input type="file" accept="image/*" className="hidden" onChange={(event) => upload(event.target.files?.[0])} />
        </label>
        <label onMouseDown={saveSelection} className="flex h-6 cursor-pointer items-center gap-1 rounded px-1.5 text-[9.5px] text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="上传附件">
          <Paperclip className="h-3 w-3" /> {uploading ? '上传中…' : '附件'}
          <input type="file" className="hidden" onChange={(event) => upload(event.target.files?.[0])} />
        </label>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        className="prose-ticket w-full max-w-full overflow-auto px-3 py-2.5 text-[11.5px] leading-6 text-slate-700 outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-slate-400"
        data-placeholder={placeholder}
        style={{ minHeight, resize: 'vertical', maxWidth: '100%' }}
        onInput={(event) => onChange(event.currentTarget.innerHTML)}
      />
    </div>
  );
}

export function RichTextContent({ html, className }: { html?: string; className?: string }) {
  if (!html) return null;
  if (!html.includes('<')) return <p className={cn('whitespace-pre-wrap', className)}>{html}</p>;
  return <div className={cn('prose-ticket', className)} dangerouslySetInnerHTML={{ __html: html }} />;
}

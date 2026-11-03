import { useEffect, useState } from 'react';
import { Link2, Pencil, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { Modal, inputClass, textareaClass } from '@/components/ui/Modal';
import { SkillGlyph } from '@/components/HarnessMark';
import { engine } from '@/lib/desktop';
import type { EngineResult, Skill } from '@/lib/types';
import { shortSha } from '@/lib/utils';
import { toast } from 'sonner';

export function EditSkillDialog({
  skill,
  skills,
  onClose,
  onDone,
}: {
  skill: Skill | null;
  skills: Skill[];
  onClose: () => void;
  onDone: (result: EngineResult) => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [alias, setAlias] = useState('');
  const [comment, setComment] = useState('');
  const [tags, setTags] = useState('');
  const [dependsOn, setDependsOn] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!skill) return;
    setDisplayName(skill.displayName);
    setAlias(skill.alias ?? '');
    setComment(skill.comment ?? '');
    setTags(skill.tags.join(', '));
    setDependsOn(skill.dependsOn ?? []);
    setSaving(false);
  }, [skill]);

  const candidates = skills
    .filter((item) => item.id !== skill?.id && !dependsOn.includes(item.slug))
    .sort((left, right) => left.slug.localeCompare(right.slug));

  const submit = async () => {
    if (!skill || saving) return;
    const api = engine();
    if (!api) {
      toast.info('桌面端专属操作', {
        description: '请通过 npm run dev 启动 Electron 窗口。',
      });
      return;
    }
    setSaving(true);
    const result = await api.editSkill({
      skillId: skill.id,
      patch: {
        displayName: displayName.trim() || skill.displayName,
        alias: alias.trim(),
        comment: comment.trim(),
        tags: tags
          .split(/[,，]/)
          .map((tag) => tag.trim())
          .filter(Boolean),
        dependsOn,
      },
    });
    setSaving(false);
    onDone(result);
    if (result.ok) onClose();
  };

  return (
    <Modal open={Boolean(skill)} onClose={onClose} ariaLabel="编辑技能信息" className="max-w-[480px]">
      <header className="flex items-start gap-2.5 border-b border-hairline px-4 py-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] border border-hairline bg-soft text-fg-muted">
          <Pencil className="h-3 w-3" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[16px] font-semibold text-fg">编辑技能信息</h2>
          <p className="mt-0.5 text-[13px] text-fg-subtle">
            只修改 Quiver 的元数据，不会写入 SKILL.md 或中央库内容。
          </p>
        </div>
        <IconButton label="关闭" onClick={onClose} className="-mr-1">
          <X className="h-3.5 w-3.5" />
        </IconButton>
      </header>

      {skill ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          <div className="flex items-center gap-2 rounded-[7px] border border-hairline bg-soft px-2.5 py-2">
            <SkillGlyph slug={skill.slug} className="h-6 w-6 text-[13px]" />
            <span className="min-w-0 flex-1 truncate font-mono text-[14px] text-fg-muted">
              {skill.slug}
            </span>
            <span className="font-mono text-[13px] text-fg-faint">
              @{shortSha(skill.activeSha)}
            </span>
          </div>

          <label className="mt-3 block">
            <span className="text-[14px] text-fg-muted">显示名称</span>
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className={`${inputClass} mt-1`}
              placeholder="用于列表与详情展示"
            />
          </label>

          <label className="mt-2.5 block">
            <span className="text-[14px] text-fg-muted">别名</span>
            <input
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              className={`${inputClass} mt-1`}
              placeholder="可选，例如 pdf"
            />
          </label>

          <label className="mt-2.5 block">
            <span className="text-[14px] text-fg-muted">标签</span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              className={`${inputClass} mt-1`}
              placeholder="用逗号分隔，例如 文档, 解析"
            />
          </label>

          <div className="mt-2.5">
            <span className="flex items-center gap-1.5 text-[14px] text-fg-muted">
              <Link2 className="h-3 w-3 text-fg-subtle" strokeWidth={1.8} />
              依赖技能
            </span>
            <div className="mt-1 flex min-h-9 flex-wrap items-center gap-1.5 rounded-[6px] border border-hairline bg-soft px-2 py-1.5">
              {dependsOn.length === 0 ? (
                <span className="text-[13px] text-fg-faint">未声明依赖</span>
              ) : (
                dependsOn.map((slug) => (
                  <span
                    key={slug}
                    className="inline-flex items-center gap-1 rounded-[4px] border border-hairline bg-soft-strong px-1.5 py-0.5 text-[13px] text-fg-muted"
                  >
                    <span className="font-mono">{slug}</span>
                    <button
                      type="button"
                      aria-label={`移除依赖 ${slug}`}
                      onClick={() =>
                        setDependsOn((prev) => prev.filter((item) => item !== slug))
                      }
                      className="rounded-[3px] p-0.5 text-fg-subtle transition-colors hover:bg-soft hover:text-rose"
                    >
                      <X className="h-2.5 w-2.5" strokeWidth={2} />
                    </button>
                  </span>
                ))
              )}
            </div>
            <select
              value=""
              aria-label="添加依赖技能"
              disabled={candidates.length === 0}
              onChange={(event) => {
                const slug = event.target.value;
                if (slug) setDependsOn((prev) => [...prev, slug]);
              }}
              className={`${inputClass} mt-1.5 h-8 text-[13px] disabled:opacity-50`}
            >
              <option value="">
                {candidates.length === 0 ? '没有可添加的技能' : '选择要依赖的技能…'}
              </option>
              {candidates.map((item) => (
                <option key={item.id} value={item.slug}>
                  {item.slug} · {item.displayName}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[13px] leading-relaxed text-fg-faint">
              依赖只写入 Quiver 元数据；禁用被依赖的技能时，会先提示受影响的入口。
            </p>
          </div>

          <label className="mt-2.5 block">
            <span className="text-[14px] text-fg-muted">备注</span>
            <textarea
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              rows={3}
              className={`${textareaClass} mt-1`}
              placeholder="这个技能解决什么问题"
            />
          </label>
        </div>
      ) : null}

      <footer className="flex items-center justify-end gap-1.5 border-t border-hairline px-4 py-2.5">
        <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void submit()}
          disabled={saving || !skill}
          className="min-w-[80px]"
        >
          {saving ? '保存中…' : '保存修改'}
        </Button>
      </footer>
    </Modal>
  );
}

import { useEffect, useRef, useState } from 'react'
import { IconCheck, IconListCheck, IconPlayerPlay, type TablerIcon } from '@tabler/icons-react'
import styles from './agent.module.scss'
import type { CollaborationMode } from './collaborationMode'

const MODES: { value: CollaborationMode; Icon: TablerIcon; label: string; desc: string }[] = [
  { value: 'default', Icon: IconPlayerPlay, label: '直接处理', desc: '分析任务，并完成修改、运行命令等操作' },
  { value: 'plan', Icon: IconListCheck, label: '制定计划', desc: '只调查并给出方案，不修改任何内容' }
]

export default function CollaborationModePicker({
  value,
  disabled = false,
  onChange
}: {
  value: CollaborationMode
  disabled?: boolean
  onChange: (value: CollaborationMode) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = MODES.find((mode) => mode.value === value) || MODES[0]

  useEffect(() => {
    if (!open) return
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocumentMouseDown)
    return () => document.removeEventListener('mousedown', onDocumentMouseDown)
  }, [open])

  const ActiveIcon = active.Icon
  return (
    <div className={styles.modePick} ref={ref} data-collaboration-mode={value}>
      <button
        type="button"
        className={styles.modeBtn}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        title="工作模式"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ActiveIcon size={14} stroke={1.7} />
        <span>{active.label}</span>
      </button>

      {open && (
        <div className={styles.modePanel} role="menu" aria-label="工作模式">
          <div className={styles.modeHeading}>选择本轮工作方式</div>
          {MODES.map((mode) => {
            const Icon = mode.Icon
            return (
              <button
                key={mode.value}
                type="button"
                className={styles.modeItem}
                role="menuitemradio"
                aria-checked={mode.value === value}
                onClick={() => {
                  onChange(mode.value)
                  setOpen(false)
                }}
              >
                <Icon size={17} stroke={1.6} className={styles.modeItemIcon} />
                <span className={styles.modeItemBody}>
                  <span className={styles.modeItemLabel}>{mode.label}</span>
                  <span className={styles.modeItemDescription}>{mode.desc}</span>
                </span>
                {mode.value === value && <IconCheck size={15} stroke={2} className={styles.modeCheck} />}
              </button>
            )
          })}
          <div className={styles.modeNote}>计划模式不会修改文件、数据、配置或其他内容。</div>
        </div>
      )}
    </div>
  )
}

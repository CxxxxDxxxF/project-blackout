import { useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Circle, SpinnerGap, XCircle, CaretDown, CaretRight, Stack, Globe, File, Terminal, Brain, Trash, ArrowCounterClockwise } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { Task, TodoItem, SwarmChildSummary } from '@accomplish_ai/agent-core/common';
import { SpinningIcon } from './SpinningIcon';

interface TaskSidebarProps {
    currentTask: Task;
    liveProgress: { percent: number; phase: string };
    todos: TodoItem[];
    swarmStats: {
        queued: number;
        running: number;
        completed: number;
        failed: number;
        cancelled: number;
        timed_out: number;
        finished: number;
        progressPct: number;
    };
    swarmChildren: SwarmChildSummary[];
    expandedSwarmChildren: Record<string, boolean>;
    onToggleSwarmChild: (childId: string) => void;
    hasSwarmChildren: boolean;
    messageQueue: string[];
    onClear: () => void;
}

export function TaskSidebar({
    currentTask,
    liveProgress,
    todos,
    swarmStats,
    swarmChildren,
    expandedSwarmChildren,
    onToggleSwarmChild,
    hasSwarmChildren,
    messageQueue,
    onClear,
}: TaskSidebarProps) {
    const { t } = useTranslation('execution');
    const [clearArmed, setClearArmed] = useState(false);
    const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleClearClick = () => {
        if (!clearArmed) {
            // First click: arm the button, auto-disarm after 3s
            setClearArmed(true);
            clearTimerRef.current = setTimeout(() => setClearArmed(false), 3000);
        } else {
            // Second click: confirmed
            if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
            setClearArmed(false);
            onClear();
        }
    };

    // Clean up arm timer on unmount
    useEffect(() => {
        return () => { if (clearTimerRef.current) clearTimeout(clearTimerRef.current); };
    }, []);

    const completed = todos.filter((t) => t.status === 'completed').length;
    const cancelled = todos.filter((t) => t.status === 'cancelled').length;
    const totalTodos = todos.length;
    const done = completed + cancelled;

    return (
        <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="w-[300px] border-l border-border bg-card/50 flex flex-col flex-shrink-0 relative z-10 hidden lg:flex"
        >
            {/* Sticky header with clear button */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-border/60 bg-card/80 backdrop-blur-sm">
                <span className="text-xs font-semibold text-foreground tracking-[0.18px] uppercase">Agent Panel</span>
                <button
                    type="button"
                    onClick={handleClearClick}
                    title={clearArmed ? 'Click again to confirm reset' : 'Clear chat & reset'}
                    className={cn(
                        'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all duration-200',
                        clearArmed
                            ? 'bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/25'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                    )}
                >
                    {clearArmed ? (
                        <><ArrowCounterClockwise className="h-3.5 w-3.5" />Confirm</>
                    ) : (
                        <><Trash className="h-3.5 w-3.5" />Clear</>
                    )}
                </button>
            </div>
            <div className="flex-1 overflow-y-auto w-full scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent">
                <div className="flex flex-col gap-6 p-4">

                    {/* Main Task Progress section */}
                    {currentTask.status === 'running' && (
                        <ProgressSection liveProgress={liveProgress} />
                    )}

                    {/* Swarm Metrics section - render only if swarms exist */}
                    {hasSwarmChildren && (
                        <div className="space-y-3 pt-2">
                            <div className="flex items-center justify-between gap-3">
                                <span className="text-xs font-semibold text-foreground tracking-[0.18px] uppercase">
                                    {t('progress.swarm', 'Swarm Progress')}
                                </span>
                                <span className="text-xs font-medium text-muted-foreground">
                                    {swarmStats.finished}/{swarmChildren.length} done
                                </span>
                            </div>

                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                                <div
                                    className="h-full bg-primary transition-all duration-300"
                                    style={{ width: `${swarmStats.progressPct}%` }}
                                />
                            </div>

                            {/* Sub-agent status swatches */}
                            <div className="flex gap-1">
                                {swarmChildren.map((child) => {
                                    const swatchClass =
                                        child.status === 'completed'
                                            ? 'bg-emerald-500'
                                            : child.status === 'running'
                                                ? 'bg-primary/45 animate-pulse'
                                                : child.status === 'failed' || child.status === 'timed_out'
                                                    ? 'bg-destructive'
                                                    : child.status === 'cancelled'
                                                        ? 'bg-muted-foreground'
                                                        : 'bg-muted';
                                    return (
                                        <div
                                            key={`progress-${child.childId}`}
                                            className={`h-2 flex-1 rounded-[1px] ${swatchClass}`}
                                            title={`${child.role}: ${child.status.replace('_', ' ')}`}
                                        />
                                    );
                                })}
                            </div>

                            {/* Detailed Swarm Rollup */}
                            <div className="flex flex-col gap-2 pt-2">
                                {swarmChildren.map((child) => {
                                    const expanded = expandedSwarmChildren[child.childId] === true;
                                    const isActive = child.status === 'running';
                                    const statusClass =
                                        child.status === 'completed'
                                            ? 'text-emerald-600'
                                            : child.status === 'running'
                                                ? 'text-primary'
                                                : child.status === 'failed' || child.status === 'timed_out'
                                                    ? 'text-destructive'
                                                    : 'text-muted-foreground';

                                    return (
                                        <div key={child.childId} className="rounded-md border border-border bg-background">
                                            <button
                                                type="button"
                                                className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                                                onClick={() => onToggleSwarmChild(child.childId)}
                                            >
                                                <div className="flex items-center gap-2 min-w-0 pr-2">
                                                    {expanded ? (
                                                        <CaretDown className="h-3 w-3 text-muted-foreground shrink-0" />
                                                    ) : (
                                                        <CaretRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                                    )}
                                                    <span className="text-[13px] capitalize truncate font-medium">{child.role}</span>
                                                </div>
                                                <span className={`text-[11px] uppercase tracking-wider flex items-center gap-1.5 shrink-0 font-medium ${statusClass}`}>
                                                    {isActive && <SpinningIcon className="h-3 w-3" />}
                                                    {child.status.replace('_', ' ')}
                                                </span>
                                            </button>

                                            <AnimatePresence>
                                                {expanded && (
                                                    <motion.div
                                                        initial={{ height: 0, opacity: 0 }}
                                                        animate={{ height: 'auto', opacity: 1 }}
                                                        exit={{ height: 0, opacity: 0 }}
                                                        className="overflow-hidden"
                                                    >
                                                        <div className="px-3 pb-3">
                                                            {child.error && (
                                                                <p className="text-xs text-destructive mb-1 bg-destructive/10 p-2 rounded">{child.error}</p>
                                                            )}
                                                            {child.outputPreview && (
                                                                <pre className="text-xs leading-relaxed text-muted-foreground bg-muted/30 rounded p-2 overflow-x-auto whitespace-pre-wrap font-mono">
                                                                    {child.outputPreview}
                                                                </pre>
                                                            )}
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Checklist / Plan section */}
                    {totalTodos > 0 && (
                        <div className="space-y-4 pt-4 border-t border-border">
                            <div className="flex items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-foreground tracking-[0.18px] uppercase">
                                    {t('todos.title', "AI task plan")}
                                </span>
                                <span className="text-xs font-medium text-muted-foreground">
                                    {done}/{totalTodos}
                                </span>
                            </div>

                            <div className="flex gap-0.5">
                                {todos.map((todo, i) => (
                                    <div
                                        key={todo.id}
                                        className={cn(
                                            'h-[3px] flex-1',
                                            i === 0 && 'rounded-l-full',
                                            i === totalTodos - 1 && 'rounded-r-full',
                                            todo.status === 'completed' || todo.status === 'cancelled'
                                                ? 'bg-foreground'
                                                : 'bg-todo-progress-pending',
                                        )}
                                    />
                                ))}
                            </div>

                            <ul className="flex flex-col gap-[2px]">
                                {todos.map((todo) => (
                                    <TodoListItem key={todo.id} todo={todo} />
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* Queued Messages section */}
                    {messageQueue.length > 0 && (
                        <div className="space-y-3 pt-4 border-t border-border">
                            <div className="flex items-center gap-1.5">
                                <Stack className="h-3.5 w-3.5 text-primary" />
                                <span className="text-xs font-semibold text-foreground tracking-[0.18px] uppercase">
                                    Queued ({messageQueue.length})
                                </span>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                {messageQueue.map((msg, idx) => (
                                    <div
                                        key={idx}
                                        className="flex items-start gap-2 rounded-md bg-muted/50 border border-border px-3 py-2"
                                    >
                                        <span className="text-[10px] font-bold text-primary/70 mt-0.5 shrink-0">#{idx + 1}</span>
                                        <span className="text-xs text-muted-foreground leading-snug line-clamp-2">{msg}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            </div>
        </motion.div>
    );
}

function ProgressSection({ liveProgress }: { liveProgress: { percent: number; phase: string } }) {
    const startedAt = useRef(Date.now());
    const [elapsed, setElapsed] = useState(0);
    const [phaseLog, setPhaseLog] = useState<Array<{ phase: string; at: number }>>([]);
    const prevPhase = useRef('');

    // Elapsed timer
    useEffect(() => {
        const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt.current) / 1000)), 1000);
        return () => clearInterval(id);
    }, []);

    // Track phase transitions for the history log
    useEffect(() => {
        if (liveProgress.phase && liveProgress.phase !== prevPhase.current) {
            prevPhase.current = liveProgress.phase;
            setPhaseLog((prev) => [
                ...prev.slice(-3), // keep last 4 total
                { phase: liveProgress.phase, at: elapsed },
            ]);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveProgress.phase]);

    const elapsedLabel = elapsed < 60
        ? `${elapsed}s`
        : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;

    // Determine icon category from phase text
    const PhaseIcon = useMemo(() => {
        const p = liveProgress.phase.toLowerCase();
        if (p.includes('browser') || p.includes('navigate') || p.includes('web') || p.includes('search')) return Globe;
        if (p.includes('file') || p.includes('read') || p.includes('write')) return File;
        if (p.includes('bash') || p.includes('command') || p.includes('script') || p.includes('terminal')) return Terminal;
        if (p.includes('plan') || p.includes('reason') || p.includes('analyz') || p.includes('think')) return Brain;
        return SpinnerGap;
    }, [liveProgress.phase]);

    const isIndeterminate = liveProgress.percent < 15;

    return (
        <div className="space-y-3">
            {/* Header row */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                    <SpinningIcon className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-semibold text-foreground tracking-[0.18px] uppercase">Live Progress</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[11px] text-muted-foreground/70">{elapsedLabel}</span>
                    <span className="text-xs font-medium tabular-nums text-muted-foreground">{liveProgress.percent}%</span>
                </div>
            </div>

            {/* Gradient progress bar */}
            <div className="relative h-2 rounded-full bg-muted overflow-hidden">
                <motion.div
                    className="h-full rounded-full"
                    style={{
                        background: 'linear-gradient(to right, hsl(var(--primary)/0.7), hsl(var(--primary)), hsl(var(--primary)/0.9))',
                    }}
                    initial={{ width: '0%' }}
                    animate={{ width: `${liveProgress.percent}%` }}
                    transition={{ duration: 0.6, ease: 'easeOut' }}
                />
                {/* Shimmer overlay when not yet complete */}
                {liveProgress.percent < 95 && (
                    <motion.div
                        className="absolute inset-y-0 w-16 rounded-full"
                        style={{
                            background: 'linear-gradient(to right, transparent, hsl(var(--primary-foreground)/0.15), transparent)',
                            left: `${Math.max(0, liveProgress.percent - 8)}%`,
                        }}
                        animate={{ opacity: [0.4, 1, 0.4] }}
                        transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
                    />
                )}
            </div>

            {/* Current phase with animated icon */}
            <AnimatePresence mode="wait">
                <motion.div
                    key={liveProgress.phase}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.2 }}
                    className="flex items-start gap-2"
                >
                    <PhaseIcon
                        className={cn(
                            'h-3.5 w-3.5 mt-[3px] shrink-0 text-primary',
                            PhaseIcon === SpinnerGap && 'animate-spin',
                        )}
                    />
                    <span className="text-sm text-foreground leading-snug font-medium">
                        {liveProgress.phase}
                    </span>
                </motion.div>
            </AnimatePresence>

            {/* Phase history log - last 3 phases that have passed */}
            {phaseLog.length > 1 && (
                <div className="flex flex-col gap-1 pt-1 border-t border-border/50">
                    {phaseLog.slice(0, -1).reverse().map((entry, i) => (
                        <div key={i} className="flex items-center gap-1.5 opacity-40 hover:opacity-70 transition-opacity">
                            <div className="h-[6px] w-[6px] rounded-full bg-muted-foreground shrink-0" />
                            <span className="text-[11px] text-muted-foreground truncate">{entry.phase}</span>
                            <span className="text-[10px] text-muted-foreground/60 ml-auto shrink-0">{entry.at}s</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

function TodoListItem({ todo }: { todo: TodoItem }) {
    return (
        <li
            className={cn(
                'flex items-start gap-2.5 rounded-lg px-2 py-2.5 transition-colors',
                todo.status === 'completed' && 'bg-todo-item-completed hover:bg-todo-item-completed/80',
                todo.status === 'in_progress' && 'bg-todo-item-in-progress',
                todo.status === 'cancelled' && 'opacity-50',
            )}
        >
            <StatusIcon status={todo.status} />
            <span
                className={cn(
                    'text-[13px] text-foreground leading-snug',
                    todo.status === 'cancelled' && 'line-through text-muted-foreground',
                    todo.status === 'pending' && 'text-muted-foreground'
                )}
            >
                {todo.content}
            </span>
        </li>
    );
}

function StatusIcon({ status }: { status: TodoItem['status'] }) {
    switch (status) {
        case 'completed':
            return <CheckCircle weight="fill" className="h-4 w-4 text-emerald-500 shrink-0 mt-[1px]" />;
        case 'in_progress':
            return <SpinnerGap className="h-4 w-4 text-primary shrink-0 mt-[1px] animate-spin" />;
        case 'cancelled':
            return <XCircle weight="fill" className="h-4 w-4 text-muted-foreground shrink-0 mt-[1px]" />;
        case 'pending':
        default:
            return <Circle className="h-4 w-4 text-muted-foreground shrink-0 mt-[1px]" />;
    }
}

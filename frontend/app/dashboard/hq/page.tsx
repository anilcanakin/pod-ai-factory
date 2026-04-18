'use client';

import React, { useEffect, useState, useRef } from 'react';
import {
  ShieldCheck,
  Zap,
  Target,
  Activity,
  UploadCloud,
  DollarSign,
  TrendingUp,
  Loader2,
  CheckCircle2,
  Cpu,
  BarChart3,
  RefreshCw,
  Eye,
  Rocket,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';

interface Task {
  id: string;
  taskType: string;
  targetCount: number;
  currentCount: number;
  isCompleted: boolean;
}

interface FinancialStats {
  currentRevenue: number;
  targetRevenue: number;
}

interface FlaggedItem {
  id: string;
  flagReason: string;
  imageUrl: string;
}

interface AiSpendStats {
  dailySpend: number;
  monthlySpend: number;
  dailyByProvider: Record<string, number>;
  monthlyByProvider: Record<string, number>;
  dailyTokens: { input: number; output: number };
  recentLogs: Array<{
    provider: string;
    modelName: string | null;
    cost: number;
    inputTokens: number;
    outputTokens: number;
    createdAt: string;
    metadata: Record<string, string> | null;
  }>;
  resetAt: string;
  currency: string;
}

export default function BossDashboard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [flaggedItems, setFlaggedItems] = useState<FlaggedItem[]>([]);
  const [financial, setFinancial] = useState<FinancialStats>({ currentRevenue: 0, targetRevenue: 20000 });
  const [loading, setLoading] = useState(true);
  const [isBulking, setIsBulking] = useState(false);
  const [targetKeyword, setTargetKeyword] = useState('boxing tee');
  
  // Creative Hub States
  const [isCreating, setIsCreating] = useState(false);
  const [creativeResult, setCreativeResult] = useState<{prompt: string, imageUrl: string, transparentUrl: string, sceneUrl?: string} | null>(null);

  // AI Spend Widget
  const [aiSpend, setAiSpend] = useState<AiSpendStats | null>(null);
  const [spendLoading, setSpendLoading] = useState(false);

  // QA Swiper States
  const [pendingItems, setPendingItems] = useState<any[]>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const socialInputRef = useRef<HTMLInputElement>(null);
  const expertInputRef = useRef<HTMLInputElement>(null);

  const [expertMemories, setExpertMemories] = useState<any[]>([]);

  // Bulk upload progress state
  interface BulkUploadProgress { total: number; done: number; errors: number; }
  const [socialProgress, setSocialProgress] = useState<BulkUploadProgress | null>(null);
  const [expertProgress, setExpertProgress] = useState<BulkUploadProgress | null>(null);

  const fetchAiSpend = async () => {
    setSpendLoading(true);
    try {
      const res = await fetch(`/api/billing/ai-spend`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setAiSpend(data);
      }
    } catch (err) {
      console.warn('AI spend fetch failed:', err);
    } finally {
      setSpendLoading(false);
    }
  };

  const fetchStats = () => {
    fetch('/api/hq/stats', { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (data.tasks) {
            setTasks(data.tasks);
            setFinancial(data.financial);
            setFlaggedItems(data.flaggedItems || []);
        }

        fetch('/api/hq/pending', { credentials: 'include' }).then(r => r.json()).then(setPendingItems).catch(console.warn);
        fetch('/api/brain', { credentials: 'include' }).then(r => r.json()).then(data => {
            setExpertMemories(data.filter((m:any) => m.sourceType === 'Expert'));
        }).catch(console.warn);

        setLoading(false);
      })
      .catch(err => {
        console.error('API Connection Error:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchStats();
    fetchAiSpend();
    // Auto-refresh every 15 seconds — catch live cent-by-cent cost updates
    const interval = setInterval(() => {
      fetchStats();
      fetchAiSpend();
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  // Calculate overall percentage for tasks
  const totalTarget = tasks.reduce((sum, t) => sum + t.targetCount, 0);
  const totalCurrent = tasks.reduce((sum, t) => sum + t.currentCount, 0);
  const percentage = totalTarget > 0 ? Math.round((totalCurrent / totalTarget) * 100) : 0;

  // Financial progress
  const financialPct = financial.targetRevenue > 0 
    ? Math.min(100, Math.round((financial.currentRevenue / financial.targetRevenue) * 100)) 
    : 0;

  // Boss Messages based on financial percentage
  const getBossMessage = () => {
    if (financialPct === 0) return "Sistem hazır. 20.000$ hedefine ulaşmak için bandı hemen çalıştır.";
    if (financialPct <= 30) return "Mesai başladı. İvme kazanmamız lazım, Bulk Process ile ürün sayısını artır.";
    if (financialPct <= 70) return "Üretim bandı tıkır tıkır işliyor. Etsy'yi domine etmeye başladık.";
    if (financialPct < 100) return "Hedefe çok az kaldı. Seri üretimi durdurma.";
    return "Aylık 20.000$ finansal hedef tamamlandı. POD İmparatorluğu genişliyor.";
  };

  const getTaskLabel = (type: string) => {
    switch(type) {
      case 'GENERATION': return 'Görsel Üretimi (FAL)';
      case 'MOCKUP': return 'Mockup Giydirme (SHARP)';
      case 'SEO': return 'Etsy SEO (AI)';
      case 'ETSY_DRAFT': return 'Etsy Draft Gönderimi';
      default: return type;
    }
  };

  const handleBulkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      if (files.length > 50) {
          toast.error("Maksimum 50 dosya seçebilirsiniz.");
          return;
      }

      setIsBulking(true);
      const formData = new FormData();
      formData.append('keyword', targetKeyword);
      Array.from(files).forEach(file => {
          formData.append('designs', file);
      });

      try {
          const res = await fetch('/api/hq/bulk', {
              method: 'POST',
              body: formData,
              credentials: 'omit'
          });
          const data = await res.json();
          if (res.ok) {
              toast.success(data.message);
              fetchStats();
          } else {
              toast.error(data.error || "Toplu işlem başlatılamadı.");
          }
      } catch (err) {
          toast.error("Bağlantı hatası.");
      } finally {
          setIsBulking(false);
          // file input'u sıfırla
          if (fileInputRef.current) fileInputRef.current.value = '';
      }
  };

  const handleOverride = async (itemId: string) => {
      try {
          const res = await fetch(`/api/hq/override/${itemId}`, { method: 'POST' });
          if (res.ok) {
              toast.success("Hukuki engel kaldırıldı. Ürün banda döndü!");
              fetchStats();
          } else {
              toast.error("Override başarısız.");
          }
      } catch(err) {
          toast.error("Override sırasında bağlantı hatası oluştu.");
      }
  };

  const handleCreativeAutonomy = async () => {
      if (!targetKeyword) {
          toast.error("Lütfen Ortak Niche/Keyword alanını doldurun.");
          return;
      }
      setIsCreating(true);
      setCreativeResult(null);
      toast("Yaratıcı Motor Başlatıldı. Sinyaller Aranıyor...", { icon: "🧠" });

      try {
          const res = await fetch(`/api/hq/generate-auto`, { 
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ niche: targetKeyword })
          });
          const data = await res.json();
          if (res.ok) {
              setCreativeResult(data);
              toast.success(data.message || "Otonom Görsel Üretimi ve De-Kupaj Tamamlandı!");
              fetchStats(); // Update UI counters right away
          } else {
              toast.error(data.error || "Görsel üretilemedi.");
          }
      } catch (err) {
          toast.error("Bağlantı hatası.");
      } finally {
          setIsCreating(false);
      }
  };

  const handleApprove = async (id: string) => {
      try {
          const res = await fetch(`/api/hq/approve/${id}`, { method: 'POST' });
          if (res.ok) {
              toast.success("Ürün Etsy'ye gönderildi!", { icon: "✅" });
              fetchStats();
          }
      } catch (err) { toast.error("Hata oluştu"); }
  };

  const handleReject = async (id: string) => {
      try {
          const res = await fetch(`/api/hq/reject/${id}`, { method: 'POST' });
          if (res.ok) {
              toast.error("Ürün çöpe atıldı.", { icon: "🗑️" });
              fetchStats();
          }
      } catch (err) { toast.error("Hata oluştu"); }
  };

  const handleApproveAll = async () => {
      try {
          const res = await fetch(`/api/hq/approve-all`, { method: 'POST' });
          if (res.ok) {
              toast.success("Tüm kuyruk Etsy'ye roketlendi!", { icon: "🚀" });
              fetchStats();
          }
      } catch (err) { toast.error("Hata oluştu"); }
  };

  const handleSocialUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      // Batch into groups of 10 to avoid browser lockup
      const BATCH = 10;
      let done = 0, errors = 0;
      setSocialProgress({ total: files.length, done: 0, errors: 0 });
      toast(`${files.length} sosyal içerik analiz kuyruğuna ekleniyor...`, { icon: "👁️‍🗨️" });

      for (let i = 0; i < files.length; i += BATCH) {
          const batch = files.slice(i, i + BATCH);
          const fd = new FormData();
          batch.forEach(f => fd.append('images', f));
          try {
              const res = await fetch('/api/brain/bulk-social', { method: 'POST', body: fd, credentials: 'include' });
              if (res.ok) {
                  const data = await res.json();
                  done += data.queued ?? batch.length;
              } else {
                  errors += batch.length;
              }
          } catch {
              errors += batch.length;
          }
          setSocialProgress({ total: files.length, done, errors });
      }

      if (errors === 0) {
          toast.success(`${done} görsel analiz kuyruğuna eklendi! Arka planda işlenecek.`);
      } else {
          toast.warning(`${done} başarılı, ${errors} hatalı.`);
      }
      setSocialProgress(null);
      fetchStats();
      if (socialInputRef.current) socialInputRef.current.value = '';
  };

  const handleExpertUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      const BATCH = 10;
      let done = 0, errors = 0;
      setExpertProgress({ total: files.length, done: 0, errors: 0 });
      toast(`${files.length} uzman stratejisi kuyruğuna ekleniyor...`, { icon: "🎓" });

      for (let i = 0; i < files.length; i += BATCH) {
          const batch = files.slice(i, i + BATCH);
          const fd = new FormData();
          batch.forEach(f => fd.append('images', f));
          try {
              const res = await fetch('/api/brain/bulk-expert', { method: 'POST', body: fd, credentials: 'include' });
              if (res.ok) {
                  const data = await res.json();
                  done += data.queued ?? batch.length;
              } else {
                  errors += batch.length;
              }
          } catch {
              errors += batch.length;
          }
          setExpertProgress({ total: files.length, done, errors });
      }

      if (errors === 0) {
          toast.success(`${done} uzman stratejisi analiz kuyruğuna eklendi!`);
      } else {
          toast.warning(`${done} başarılı, ${errors} hatalı.`);
      }
      setExpertProgress(null);
      fetchStats();
      if (expertInputRef.current) expertInputRef.current.value = '';
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-bg-base text-text-primary p-6">
      <div className="flex flex-col items-center gap-4">
        <Activity className="animate-spin text-accent w-12 h-12" />
        <span className="font-mono text-sm tracking-widest uppercase">HQ Sisteme Bağlanıyor...</span>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-bg-base text-text-primary p-8 font-sans selection:bg-accent selection:text-white pb-20">
      {/* ── Boss Header ── */}
      <header className="max-w-6xl mx-auto mb-10 border-l-4 border-accent pl-6 py-2">
        <h1 className="text-sm font-mono text-accent uppercase tracking-[0.3em] mb-2 flex items-center gap-2">
          <ShieldCheck size={16} /> SERİ ÜRETİM DİSİPLİNİ / HQ
        </h1>
        <p className="text-3xl md:text-4xl font-bold tracking-tight leading-tight max-w-4xl text-text-primary">
          "{getBossMessage()}"
        </p>
      </header>

      <main className="max-w-6xl mx-auto space-y-8">

        {/* ── MALİ ŞEFFAFLIK: AI HARCAMA WIDGET ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Günlük Harcama */}
          <div className="col-span-1 sm:col-span-1 bg-gradient-to-br from-emerald-950/60 to-[#0a1a10] border border-emerald-500/25 rounded-xl p-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-400/5 rounded-full blur-2xl translate-x-6 -translate-y-6" />
            <div className="relative z-10">
              <p className="text-[10px] font-mono text-emerald-400/70 uppercase tracking-[0.25em] mb-1 flex items-center gap-1">
                <Cpu size={10} /> Günlük AI Harcama
              </p>
              <p className="text-3xl font-black text-emerald-300 tabular-nums">
                ${aiSpend ? aiSpend.dailySpend.toFixed(4) : '—'}
              </p>
              <p className="text-[10px] text-emerald-500/60 mt-1 font-mono">
                {aiSpend ? `${(aiSpend.dailyTokens.input + aiSpend.dailyTokens.output).toLocaleString()} token` : 'Yükleniyor...'}
              </p>
              <p className="text-[9px] text-emerald-700 mt-2 font-mono">
                Sıfırlanma: gece 00:00
              </p>
            </div>
          </div>

          {/* Aylık Toplam */}
          <div className="col-span-1 bg-gradient-to-br from-blue-950/60 to-[#080e1a] border border-blue-500/20 rounded-xl p-5 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-400/5 rounded-full blur-2xl translate-x-6 -translate-y-6" />
            <div className="relative z-10">
              <p className="text-[10px] font-mono text-blue-400/70 uppercase tracking-[0.25em] mb-1 flex items-center gap-1">
                <BarChart3 size={10} /> Aylık Toplam
              </p>
              <p className="text-3xl font-black text-blue-300 tabular-nums">
                ${aiSpend ? aiSpend.monthlySpend.toFixed(4) : '—'}
              </p>
              <p className="text-[10px] text-blue-500/60 mt-1 font-mono">
                {aiSpend ? `${Object.keys(aiSpend.monthlyByProvider).length} provider aktif` : 'Yükleniyor...'}
              </p>
              <p className="text-[9px] text-blue-700 mt-2 font-mono">
                {new Date().toLocaleString('tr-TR', { month: 'long', year: 'numeric' })}
              </p>
            </div>
          </div>

          {/* Provider Breakdown */}
          <div className="col-span-1 sm:col-span-2 bg-[#0c0e12] border border-border-default rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <p className="text-[10px] font-mono text-text-tertiary uppercase tracking-[0.2em] flex items-center gap-1">
                <Zap size={10} className="text-accent" /> Provider Breakdown (Bugün)
              </p>
              <button
                onClick={fetchAiSpend}
                disabled={spendLoading}
                className="text-text-tertiary hover:text-accent transition-colors"
              >
                <RefreshCw size={12} className={spendLoading ? 'animate-spin' : ''} />
              </button>
            </div>

            {aiSpend && Object.keys(aiSpend.dailyByProvider).length > 0 ? (
              <div className="space-y-2">
                {Object.entries(aiSpend.dailyByProvider)
                  .sort(([, a], [, b]) => b - a)
                  .map(([provider, cost]) => {
                    const pct = aiSpend.dailySpend > 0 ? (cost / aiSpend.dailySpend) * 100 : 0;
                    const color = provider === 'anthropic' ? 'bg-orange-500' : provider === 'gemini' ? 'bg-blue-500' : 'bg-purple-500';
                    const label = provider === 'anthropic' ? 'Claude (Anthropic)' : provider === 'gemini' ? 'Gemini (Google)' : provider.toUpperCase();
                    return (
                      <div key={provider}>
                        <div className="flex justify-between text-[10px] font-mono mb-1">
                          <span className="text-text-secondary">{label}</span>
                          <span className="text-text-primary">${cost.toFixed(5)}</span>
                        </div>
                        <div className="h-1 w-full bg-bg-elevated rounded-full overflow-hidden">
                          <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
              </div>
            ) : (
              <div className="flex items-center gap-2 text-text-tertiary text-xs font-mono py-2">
                <Activity size={12} className={spendLoading ? 'animate-pulse' : ''} />
                {spendLoading ? 'Veriler çekiliyor...' : 'Bugün henüz AI çağrısı yapılmadı'}
              </div>
            )}

            {/* Son İşlem Feed */}
            {aiSpend?.recentLogs && aiSpend.recentLogs.length > 0 && (
              <div className="mt-3 pt-3 border-t border-border-subtle">
                <p className="text-[9px] font-mono text-text-tertiary uppercase tracking-widest mb-2">Son İşlemler</p>
                <div className="space-y-1 max-h-28 overflow-y-auto">
                  {aiSpend.recentLogs.slice(0, 6).map((log, i) => (
                    <div key={i} className="flex items-center justify-between text-[9px] font-mono">
                      <span className="text-text-tertiary truncate max-w-[140px]">
                        {log.provider}/{log.modelName?.split('-').slice(0, 2).join('-') || '?'}
                        {log.metadata?.feature ? ` · ${log.metadata.feature}` : ''}
                      </span>
                      <span className={`${Number(log.cost) > 0 ? 'text-emerald-400' : 'text-text-tertiary'} tabular-nums shrink-0 ml-2`}>
                        +${Number(log.cost).toFixed(5)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── FINANSAL HEDEF BAR (Aylık 20.000$) ── */}
        <div className="bg-gradient-to-r from-[#0d1511] to-[#0a1015] border border-success/20 rounded-xl p-8 relative overflow-hidden">
            {/* Animasyonlu arkaplan efekti */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-success/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
            
            <div className="relative z-10 flex flex-col md:flex-row md:items-end justify-between gap-6 mb-6">
                <div>
                    <h2 className="text-success flex items-center gap-2 font-mono text-xs uppercase tracking-widest font-bold mb-2">
                        <TrendingUp size={16} /> Finansal Hedef 
                    </h2>
                    <div className="flex items-baseline gap-3">
                        <span className="text-5xl font-black text-white">${financial.currentRevenue.toLocaleString()}</span>
                        <span className="text-text-tertiary text-lg font-medium">/ ${financial.targetRevenue.toLocaleString()}</span>
                    </div>
                </div>
                <div className="bg-bg-elevated/50 px-4 py-2 rounded-lg border border-border-default flex items-center gap-3 backdrop-blur-sm">
                    <DollarSign className="text-success" />
                    <div>
                        <p className="text-[10px] text-text-tertiary uppercase">Tahmini Kalan</p>
                        <p className="text-sm font-bold">${Math.max(0, financial.targetRevenue - financial.currentRevenue).toLocaleString()}</p>
                    </div>
                </div>
            </div>

            {/* İlerleme Çubuğu */}
            <div className="relative z-10">
                <div className="flex justify-between text-xs font-mono text-text-tertiary mb-2">
                    <span>%0</span>
                    <span className="text-success font-bold">%{financialPct}</span>
                    <span>%100</span>
                </div>
                <div className="h-4 w-full bg-bg-surface rounded-full overflow-hidden border border-success/10 p-0.5">
                    <div 
                        className="h-full bg-success/80 rounded-full transition-all duration-1000 relative"
                        style={{ width: `${financialPct}%` }}
                    >
                        <div className="absolute top-0 right-0 bottom-0 left-0 bg-[linear-gradient(45deg,rgba(255,255,255,.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,.15)_50%,rgba(255,255,255,.15)_75%,transparent_75%,transparent)] bg-[length:1rem_1rem] animate-[progress-stripes_1s_linear_infinite]"></div>
                    </div>
                </div>
            </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* ── GÜNLÜK KOTA PANELİ ── */}
            <div className="lg:col-span-2 space-y-6">
                <div className="bg-bg-surface border border-border-default rounded-xl p-6 h-full">
                    <h2 className="text-xs font-mono text-text-tertiary uppercase tracking-widest mb-6 flex items-center gap-2">
                    <Target size={14} /> GÜNLÜK ÜRETİM KOTALARI
                    </h2>
                    
                    <div className="space-y-8">
                    {tasks.length > 0 ? tasks.map((task) => {
                        const taskPct = task.targetCount > 0 ? Math.min(100, Math.round((task.currentCount / task.targetCount) * 100)) : 0;
                        return (
                        <div key={task.id} className="space-y-3">
                            <div className="flex justify-between items-end">
                            <span className="text-sm font-semibold tracking-wide uppercase">{getTaskLabel(task.taskType)}</span>
                            <span className="text-xs font-mono text-text-secondary">
                                {task.currentCount} / {task.targetCount} <span className="text-accent ml-2">%{taskPct}</span>
                            </span>
                            </div>
                            {/* Progress Bar Container */}
                            <div className="h-2 w-full bg-bg-elevated rounded-full overflow-hidden border border-border-subtle">
                            <div 
                                className={`h-full transition-all duration-700 ease-out rounded-full ${taskPct >= 100 ? 'bg-success' : 'bg-accent shadow-[0_0_10px_rgba(124,58,237,0.5)]'}`}
                                style={{ width: `${taskPct}%` }}
                            ></div>
                            </div>
                        </div>
                        );
                    }) : (
                        <div className="py-10 text-center border-2 border-dashed border-border-subtle rounded-lg text-text-tertiary">
                        Veri yükleniyor...
                        </div>
                    )}
                    </div>
                </div>

                {/* ── LEGAL GUARD (FLAGGED ITEMS) PANELİ ── */}
                {flaggedItems.length > 0 && (
                    <div className="bg-red-950/20 border border-red-500/30 rounded-xl p-6 h-max">
                        <h2 className="text-xs font-mono text-red-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                            <ShieldCheck size={14} className="text-red-500" /> LEGAL GUARD: ENGELLENENLER
                        </h2>
                        <div className="space-y-4">
                            {flaggedItems.map(item => (
                                <div key={item.id} className="bg-bg-base border border-red-500/20 rounded-lg p-4 flex gap-4 items-center">
                                    <img src={`/${item.imageUrl}`} alt="flagged" className="w-16 h-16 object-cover rounded-md" />
                                    <div className="flex-1">
                                        <h3 className="text-sm font-bold text-red-400">Marka / Telif İhlali</h3>
                                        <p className="text-xs text-text-tertiary font-mono break-all">{item.flagReason}</p>
                                    </div>
                                    <button 
                                        onClick={() => handleOverride(item.id)}
                                        className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/50 px-3 py-2 rounded text-[10px] font-bold uppercase tracking-wider transition-all"
                                    >
                                        Riskli: Yoksay
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* ── BULK PROCESS & SIDEBAR ── */}
            <div className="space-y-6">
                {/* Otonom Üretim Bandı Tetikleyici */}
                <div className="bg-gradient-to-br from-accent/10 to-transparent border border-accent/20 rounded-xl p-6 text-center shadow-lg relative overflow-hidden">
                    <div className="absolute -right-4 -top-4 text-accent/10">
                        <Zap size={100} />
                    </div>
                    <h3 className="text-lg font-bold text-accent mb-2 relative z-10">Otonom Üretim Bandı</h3>
                    <p className="text-sm text-text-secondary mb-4 relative z-10 leading-relaxed">
                        Toplu tasarım yükleyin. Mockup, Market Araştırması, RAG SEO ve Etsy Draft işlemleri insan müdahalesi olmadan akar.
                    </p>

                    <div className="relative z-10 mb-6 text-left">
                        <label className="text-xs font-mono uppercase text-text-tertiary mb-1 block">Ortak Niche/Keyword</label>
                        <input 
                            type="text" 
                            className="w-full bg-[#0c0d10] border border-border-default rounded-md px-3 py-2 text-sm text-white focus:border-accent focus:outline-none"
                            value={targetKeyword}
                            onChange={(e) => setTargetKeyword(e.target.value)}
                            disabled={isBulking}
                            placeholder="Örn: boxing tee, gym motivation..."
                        />
                    </div>

                    <input 
                        type="file" 
                        multiple 
                        accept="image/png, image/jpeg, image/webp" 
                        className="hidden" 
                        ref={fileInputRef}
                        onChange={handleBulkUpload}
                        disabled={isBulking}
                    />

                    <button 
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isBulking}
                        className="w-full bg-accent hover:bg-accent-hover text-white py-4 rounded-lg font-bold uppercase tracking-wider flex justify-center items-center gap-3 transition-all active:scale-95 disabled:opacity-50 shadow-[0_4px_20px_rgba(124,58,237,0.3)]"
                    >
                        {isBulking ? (
                            <><Loader2 className="w-5 h-5 animate-spin" /> TASARIMLAR İŞLENİYOR...</>
                        ) : (
                            <><UploadCloud className="w-5 h-5" /> BULK PROCESS BAŞLAT (20-30 Dosya)</>
                        )}
                    </button>
                    {isBulking && (
                        <p className="text-xs text-accent mt-3 animate-pulse font-mono">
                            Otonom Pipeline Devrede...
                        </p>
                    )}
                </div>

                {/* ── CREATIVE AUTONOMY ── */}
                <div className="bg-gradient-to-tr from-accent/5 to-transparent border border-accent/30 rounded-xl p-6 text-center shadow-lg relative overflow-hidden">
                    <h3 className="text-lg font-bold text-accent mb-2 relative z-10">Yaratıcı Otonomi (Faz 2)</h3>
                    <p className="text-sm text-text-secondary mb-4 relative z-10 leading-relaxed">
                        Pazar analizinden direkt grafik üretime. (Trend Bul → Prompt → Görsel → Arkaplan Sil)
                    </p>

                    <button 
                        onClick={handleCreativeAutonomy}
                        disabled={isCreating}
                        className="w-full bg-border-strong hover:bg-bg-elevated border border-accent text-accent py-3 rounded-lg font-bold uppercase tracking-wider flex justify-center items-center gap-3 transition-all active:scale-95 disabled:opacity-50"
                    >
                        {isCreating ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> TASARLANIYOR...</>
                        ) : (
                            <><Zap className="w-4 h-4" /> OTONOM TASARIM ÜRET</>
                        )}
                    </button>

                    {creativeResult && (
                        <div className="mt-6 text-left border-t border-accent/20 pt-4">
                            <h4 className="text-xs font-mono text-success uppercase mb-3">✅ Başarıyla Üretildi</h4>
                            
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                {/* 1. Ham Dekupe Tasarım */}
                                <div className="bg-bg-base border border-border-default rounded flex justify-center p-2 relative group items-center min-h-[140px]">
                                    <div className="absolute inset-0 bg-[url('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAHElEQVQYV2NkYGD4z0AEYBw1kMgA04mIioHAAwAIwwEFAvj2+QAAAABJRU5ErkJggg==')] opacity-10 rounded"></div>
                                    <img src={`/${creativeResult.transparentUrl}`} alt="Generated Design" className="w-28 h-28 object-contain relative z-10 drop-shadow-xl" />
                                    <span className="absolute bottom-2 left-2 text-[8px] font-mono uppercase bg-black/60 px-2 py-0.5 rounded text-white z-20">Ham Baskı</span>
                                </div>

                                {/* 2. Lifestyle Sahne Mockup */}
                                {creativeResult.sceneUrl ? (
                                    <div className="bg-bg-base border border-border-default rounded flex justify-center p-0 relative group items-center overflow-hidden min-h-[140px]">
                                        <img src={`/${creativeResult.sceneUrl}`} alt="Lifestyle Scene" className="w-full h-full object-cover relative z-10" />
                                        <span className="absolute bottom-2 right-2 text-[8px] font-mono uppercase bg-accent/80 px-2 py-0.5 rounded text-white z-20 shadow">Psikolojik Sahne</span>
                                    </div>
                                ) : (
                                    <div className="bg-bg-base border border-dashed border-border-default rounded flex justify-center items-center p-2 min-h-[140px]">
                                        <span className="text-[10px] text-text-tertiary">Sahne Hazırlanıyor...</span>
                                    </div>
                                )}
                            </div>

                            <p className="text-[10px] text-text-tertiary font-mono break-all line-clamp-3 bg-[#0a0d14] p-3 rounded border border-border-subtle">
                                <span className="text-accent">Prompt:</span> {creativeResult.prompt}
                            </p>
                        </div>
                    )}
                </div>

                {/* ── SOSYAL İSTİHBARAT YÜKLE (DESIGN BRAIN RAG) ── */}
                <div className="bg-[#141820] border-2 border-dashed border-accent/20 rounded-xl p-6 text-center hover:border-accent/50 transition-all group">
                    <h3 className="text-sm font-bold text-text-primary mb-3 flex items-center justify-center gap-2">
                        <UploadCloud className="text-accent group-hover:animate-bounce" size={18} /> SOSYAL İSTİHBARAT YÜKLE
                    </h3>
                    <p className="text-[10px] text-text-tertiary mb-4 leading-relaxed">
                        Instagram trendlerini görsele dönüştürün. Vision API DNA'yı çıkarır ve 'Design Brain'e (RAG) ekler.
                    </p>
                    
                    <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="hidden"
                        ref={socialInputRef}
                        onChange={handleSocialUpload}
                    />

                    {socialProgress ? (
                        <div className="w-full space-y-2">
                            <div className="flex justify-between text-[10px] text-text-tertiary font-mono">
                                <span>Yükleniyor...</span>
                                <span>{socialProgress.done}/{socialProgress.total}</span>
                            </div>
                            <div className="h-1.5 bg-bg-base rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-accent rounded-full transition-all duration-300"
                                    style={{ width: `${Math.round((socialProgress.done / socialProgress.total) * 100)}%` }}
                                />
                            </div>
                        </div>
                    ) : (
                        <button
                            onClick={() => socialInputRef.current?.click()}
                            className="w-full bg-bg-surface hover:bg-bg-elevated border border-border-default text-text-secondary py-3 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all"
                        >
                            Görsel Seç veya Sürükle (Çoklu)
                        </button>
                    )}
                </div>
            </div>
        </div>
        
        {/* ── THE SWIPER (QA) UI ── */}
        {pendingItems.length > 0 && (
            <div className="mt-8 border-t border-border-default pt-8">
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2"><Eye className="text-accent" /> Kalite Kontrol (Onay Bekleyenler)</h2>
                        <p className="text-sm text-text-secondary">AI üretimleri bitirdi, Etsy Draft öncesi son komutan onayı bekliyor. ({pendingItems.length} Ürün)</p>
                    </div>
                    <button onClick={handleApproveAll} className="bg-success text-white px-6 py-2 rounded font-bold uppercase tracking-wider flex items-center gap-2 hover:bg-success/80 transition shadow-lg shadow-success/20">
                        <Rocket className="w-5 h-5" /> HEPSİNİ ONAYLA
                    </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {pendingItems.map(item => (
                        <div key={item.id} className="bg-bg-elevated border border-border-default rounded-xl overflow-hidden shadow-lg group">
                            {/* Görsel Galeri (Raw + Mockup) */}
                            <div className="grid grid-cols-2 h-40 bg-[#0a0d14]">
                                <div className="relative border-r border-border-subtle p-2 flex items-center justify-center">
                                    <img src={`/${item.masterFileUrl}`} className="max-w-full max-h-full object-contain" alt="Raw" />
                                    <span className="absolute top-2 left-2 bg-black/80 font-mono text-[8px] text-white px-1.5 py-0.5 rounded">RAW ART</span>
                                </div>
                                <div className="relative p-2 flex items-center justify-center">
                                    {item.mockups?.[0] ? (
                                        <img src={`/${item.mockups[0].mockupUrl}`} className="max-w-full max-h-full object-cover rounded" alt="Mockup" />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-xs text-text-tertiary">No Scene</div>
                                    )}
                                    <span className="absolute top-2 left-2 bg-accent/80 font-mono text-[8px] text-white px-1.5 py-0.5 rounded shadow">SCENE</span>
                                </div>
                            </div>
                            
                            {/* SEO Özet */}
                            <div className="p-4 bg-bg-base">
                                <h3 className="font-bold text-sm text-white line-clamp-1">{item.seoData?.title || 'Etsysiz Ürün'}</h3>
                                <p className="text-xs text-text-tertiary mt-1 line-clamp-2">{item.seoData?.description}</p>
                                <div className="mt-3 flex flex-wrap gap-1">
                                    {item.seoData?.tags?.slice(0,4).map((tag:string, i:number) => (
                                        <span key={i} className="text-[9px] bg-border-strong text-text-secondary px-1.5 py-0.5 rounded-full">{tag}</span>
                                    ))}
                                    {item.seoData?.tags?.length > 4 && <span className="text-[9px] text-text-tertiary">+{item.seoData.tags.length - 4}</span>}
                                </div>
                            </div>

                            {/* One-Click İnfaz */}
                            <div className="grid grid-cols-2 divide-x divide-border-subtle border-t border-border-default">
                                <button onClick={() => handleReject(item.id)} className="flex items-center justify-center gap-2 py-3 text-xs font-bold text-error hover:bg-error hover:text-white transition group-hover:opacity-100">
                                    <Trash2 className="w-4 h-4" /> ÇÖPE AT
                                </button>
                                <button onClick={() => handleApprove(item.id)} className="flex items-center justify-center gap-2 py-3 text-xs font-bold text-success hover:bg-success hover:text-white transition group-hover:opacity-100">
                                    <CheckCircle2 className="w-4 h-4" /> ETSY DRAFT GÖNDER
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        )}

        {/* ── THE EXPERT INSIGHTS (UZMAN HAFIZASI) GALLERY ── */}
        <div className="mt-12 border-t border-border-default pt-8">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h2 className="text-xl font-bold flex items-center gap-2"><ShieldCheck className="text-success" /> Uzman Hafızası (Strategy Hub)</h2>
                    <p className="text-sm text-text-secondary">Instagram aboneliklerinden gelen stratejik veriler. Üretimde %50 ağırlıklı kullanılır.</p>
                </div>
                <div>
                    <input type="file" accept="image/*" multiple className="hidden" ref={expertInputRef} onChange={handleExpertUpload} />
                    {expertProgress ? (
                        <div className="flex items-center gap-3">
                            <div className="flex-1 space-y-1">
                                <div className="flex justify-between text-[10px] text-text-tertiary font-mono">
                                    <span>Yükleniyor...</span>
                                    <span>{expertProgress.done}/{expertProgress.total}</span>
                                </div>
                                <div className="h-1.5 bg-bg-base rounded-full overflow-hidden w-36">
                                    <div
                                        className="h-full bg-success rounded-full transition-all duration-300"
                                        style={{ width: `${Math.round((expertProgress.done / expertProgress.total) * 100)}%` }}
                                    />
                                </div>
                            </div>
                            <Loader2 className="w-4 h-4 animate-spin text-success" />
                        </div>
                    ) : (
                        <button onClick={() => expertInputRef.current?.click()} className="bg-success/20 text-success border border-success/50 px-5 py-2 rounded font-bold text-xs uppercase hover:bg-success/30 transition shadow-lg shadow-success/10">
                            + STRATEJİ YÜKLE (Çoklu)
                        </button>
                    )}
                </div>
            </div>

            {expertMemories.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    {expertMemories.slice(0, 8).map(m => (
                        <div key={m.id} className="bg-bg-elevated border border-border-default rounded-lg overflow-hidden flex flex-col group hover:border-success/50 transition-all">
                            <div className="h-32 bg-black relative">
                                <img src={`/${m.sourceUrl}`} className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition" alt="Strategy" />
                                <div className="absolute top-2 left-2 flex gap-1">
                                    <span className="bg-success text-black text-[8px] font-black px-1.5 py-0.5 rounded shadow">EXPERT</span>
                                    <span className="bg-white/20 backdrop-blur-sm text-white text-[8px] font-mono px-1.5 py-0.5 rounded uppercase">{m.analysisResult?.recommendedNiche || 'Niche'}</span>
                                </div>
                            </div>
                            <div className="p-3">
                                <p className="text-[10px] font-mono text-text-tertiary mb-2 line-clamp-1">{m.title}</p>
                                <p className="text-[11px] text-text-secondary line-clamp-3 italic">"{m.analysisResult?.aiStrategy || m.content}"</p>
                                <div className="mt-2 flex gap-1">
                                    {m.analysisResult?.keywords?.slice(0,3).map((k:string, i:number) => (
                                        <span key={i} className="text-[7px] border border-border-strong text-text-tertiary px-1 py-0.5 rounded uppercase">{k}</span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="py-12 text-center border-2 border-dashed border-border-subtle rounded-xl text-text-tertiary font-mono text-xs uppercase">
                    Strateji verisi bulunamadı. Uzman Postu yükleyerek RAG'i besleyin.
                </div>
            )}
        </div>
      </main>
    </div>
  );
}

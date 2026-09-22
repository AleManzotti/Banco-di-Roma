import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  LayoutDashboard, Users, FileText, Wallet, Search, Bell, Plus,
  ChevronDown, ChevronLeft, ChevronRight, X, Trash2, Pencil,
  ArrowUpDown, Menu, AlertTriangle, CheckCircle2,
  Settings2, ArrowLeft, Calendar, DollarSign, Landmark, LogOut, Download, MessageCircle,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
  CartesianGrid, BarChart, Bar, Cell,
} from "recharts";
import logoPrimeiraTela from "./assets/di roma sm fundo.png";
import LOGINS from "../logins.json";
import { auth, db as fsdb } from "./firebase";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";
import {
  collection, doc, onSnapshot, writeBatch, runTransaction, query, where, getDocs, setDoc,
} from "firebase/firestore";

/* ------------------------------------------------------------------ */
/* utilidades                                                          */
/* ------------------------------------------------------------------ */

const BRL = (v) =>
  (Number(v) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const round2 = (v) => Math.round((Number(v) + Number.EPSILON) * 100) / 100;
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (s) => (s ? s.split("-").reverse().join("/") : "—");
const fmtDateTime = (s) => {
  if (!s) return "—";
  const [d, t] = s.split("T");
  return `${fmtDate(d)} ${(t || "").slice(0, 5)}`;
};
const addMonths = (isoStr, n) => {
  const [y, m, d] = isoStr.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
};
const daysBetween = (a, b) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
const onlyDigits = (s) => (s || "").replace(/\D/g, "");

const maskCpfCnpj = (v) => {
  const d = onlyDigits(v).slice(0, 14);
  if (d.length <= 11)
    return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2");
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
};
const maskPhone = (v) => {
  const d = onlyDigits(v).slice(0, 11);
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
};
const maskCep = (v) => onlyDigits(v).slice(0, 8).replace(/(\d{5})(\d)/, "$1-$2");
const maskDateBR = (v) => {
  const d = onlyDigits(v).slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return d.replace(/(\d{2})(\d+)/, "$1/$2");
  return d.replace(/(\d{2})(\d{2})(\d+)/, "$1/$2/$3");
};
const parseDateBR = (masked) => {
  if (masked.length !== 10) return null;
  const [dd, mm, yyyy] = masked.split("/");
  const d = Number(dd), m = Number(mm), y = Number(yyyy);
  if (!(y > 1900 && y < 2200 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const teste = new Date(Date.UTC(y, m - 1, d));
  if (teste.getUTCFullYear() !== y || teste.getUTCMonth() !== m - 1 || teste.getUTCDate() !== d) return null;
  return `${yyyy}-${mm}-${dd}`;
};

function validCPF(v) {
  const c = onlyDigits(v);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  let s = 0;
  for (let i = 0; i < 9; i++) s += Number(c[i]) * (10 - i);
  let r = (s * 10) % 11 % 10;
  if (r !== Number(c[9])) return false;
  s = 0;
  for (let i = 0; i < 10; i++) s += Number(c[i]) * (11 - i);
  r = (s * 10) % 11 % 10;
  return r === Number(c[10]);
}
function validCNPJ(v) {
  const c = onlyDigits(v);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len) => {
    let pos = len - 7, sum = 0;
    for (let i = 0; i < len; i++) {
      sum += Number(c[i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}
const validDoc = (v) => {
  const d = onlyDigits(v);
  return d.length === 11 ? validCPF(d) : d.length === 14 ? validCNPJ(d) : false;
};

/* matemática do empréstimo (tabela Price) */
const pmt = (pv, i, n) => {
  if (i <= 0) return pv / n;
  const f = Math.pow(1 + i, n);
  return (pv * i * f) / (f - 1);
};
function buildSchedule(pv, ratePct, n, firstDate, parcelaFixa) {
  const i = ratePct / 100;
  let saldo = pv;
  const rows = [];
  for (let k = 1; k <= n; k++) {
    const juros = round2(saldo * i);
    let parcela = round2(parcelaFixa);
    let amort = round2(parcela - juros);
    if (k === n) {
      amort = round2(saldo);
      parcela = round2(amort + juros);
    }
    saldo = round2(saldo - amort);
    rows.push({
      number: k,
      dueDate: addMonths(firstDate, k - 1),
      originalAmount: parcela,
      interestAmount: juros,
      paidAmount: 0,
    });
  }
  return rows;
}

/* agenda com parcela fixa definida manualmente — todas as parcelas iguais, sem ajuste na última */
function buildFlatSchedule(pv, n, parcela, firstDate) {
  const total = round2(parcela * n);
  const totalJuros = round2(total - pv);
  const jurosBase = round2(totalJuros / n);
  const rows = [];
  let acumJuros = 0;
  for (let k = 1; k <= n; k++) {
    const juros = k === n ? round2(totalJuros - acumJuros) : jurosBase;
    acumJuros = round2(acumJuros + juros);
    rows.push({
      number: k,
      dueDate: addMonths(firstDate, k - 1),
      originalAmount: parcela,
      interestAmount: juros,
      paidAmount: 0,
    });
  }
  return rows;
}

/* status calculado */
function instStatus(inst, hoje) {
  if (inst.canceled) return "Cancelado";
  const saldo = round2(inst.originalAmount - inst.paidAmount);
  if (saldo <= 0.004) return "Pago";
  const diff = daysBetween(hoje, inst.dueDate);
  if (diff < 0) return "Vencido";
  if (diff === 0) return "Vence hoje";
  if (inst.paidAmount > 0) return "Parcial";
  return "Aberto";
}
const saldoOf = (i) => round2(i.originalAmount - i.paidAmount);

function linkWhatsappContrato(cliente, benefName, inf, hoje) {
  const contatoBatido = cliente?.contacts?.find((c) => c.name.trim().toLowerCase() === benefName?.trim().toLowerCase());
  const telefoneCru = contatoBatido?.phone || cliente?.phone;
  const digitos = onlyDigits(telefoneCru);
  if (digitos.length < 10) return null;
  const numero = digitos.length <= 11 ? "55" + digitos : digitos;

  const proxima = inf.list.find((i) => !i.canceled && i.dueDate === inf.proximoVencimento);
  let mensagem = `Olá ${benefName}!`;
  if (proxima) {
    const d = daysBetween(hoje, proxima.dueDate);
    const valor = BRL(saldoOf(proxima));
    const dataFmt = fmtDate(proxima.dueDate);
    if (d > 0 && d <= 3) mensagem = `Olá ${benefName}, passando pra lembrar que sua parcela de ${valor} vence dia ${dataFmt}. Qualquer coisa estou à disposição!`;
    else if (d === 0) mensagem = `Olá ${benefName}, sua parcela de ${valor} vence hoje (${dataFmt}). Fico no aguardo, obrigado!`;
    else if (d < 0 && d >= -7) mensagem = `Olá ${benefName}, notei que a parcela de ${valor} com vencimento em ${dataFmt} ainda está em aberto. Pode verificar pra mim, por favor?`;
    else if (d < -7) mensagem = `Olá ${benefName}, sua parcela venceu há ${Math.abs(d)} dias e ainda consta em aberto. Poderia regularizar o quanto antes? Qualquer dúvida me chama.`;
  }
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

const BADGE = {
  "Pago": "bg-gold-950 text-gold-400 border-gold-800",
  "Vencido": "bg-rose-950 text-rose-400 border-rose-800",
  "Vence hoje": "bg-amber-950 text-amber-400 border-amber-800",
  "Parcial": "bg-sky-950 text-sky-400 border-sky-800",
  "Aberto": "bg-navy-800 text-navy-300 border-navy-700",
  "Cancelado": "bg-navy-900 text-navy-500 border-navy-800",
  "Em andamento": "bg-sky-950 text-sky-400 border-sky-800",
  "Quitado": "bg-gold-950 text-gold-400 border-gold-800",
  "Ativo": "bg-gold-950 text-gold-400 border-gold-800",
  "Inativo": "bg-navy-900 text-navy-500 border-navy-800",
  "Cheque": "bg-gold-950 text-gold-400 border-gold-800",
  "Crédito pessoal": "bg-orange-950 text-orange-400 border-orange-800",
  "Duplicata": "bg-sky-950 text-sky-400 border-sky-800",
};

const TIPOS = ["Crédito pessoal", "Duplicata", "Cheque"];
const WIZARD_TIPOS = ["Crédito pessoal", "Duplicata"];
const TIPO_COR = { "Crédito pessoal": "#fb923c", "Duplicata": "#38bdf8", "Cheque": "#34d399" };
const METODOS = ["PIX", "Dinheiro", "Transferência", "Boleto", "Cartão"];
const GENEROS = ["Masculino", "Feminino", "Outro", "Prefiro não informar"];
const ESTADO_CIVIL = ["Solteiro(a)", "Casado(a)", "Divorciado(a)", "Viúvo(a)", "União estável"];

/* ------------------------------------------------------------------ */
/* dados iniciais                                                      */
/* ------------------------------------------------------------------ */

function exportCsv(filename, headers, rows) {
  const linha = (vals) => vals.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(";");
  const csv = [linha(headers), ...rows.map(linha)].join("\r\n");
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ------------------------------------------------------------------ */
/* componentes básicos                                                 */
/* ------------------------------------------------------------------ */

function Badge({ children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${BADGE[children] || BADGE["Aberto"]}`}>
      {children}
    </span>
  );
}

function Btn({ variant = "primary", size = "md", className = "", ...props }) {
  const base = "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-gold-500 focus:ring-offset-2 focus:ring-offset-navy-950 disabled:opacity-40 disabled:cursor-not-allowed";
  const sizes = { sm: "px-3 py-1.5 text-xs", md: "px-4 py-2 text-sm" };
  const variants = {
    primary: "bg-gold-300 text-navy-950 hover:bg-gold-200",
    ghost: "text-navy-300 hover:bg-navy-800 hover:text-navy-100",
    outline: "border border-navy-700 text-navy-200 hover:bg-navy-800",
    danger: "bg-rose-600 text-white hover:bg-rose-500",
    success: "bg-emerald-600 text-white hover:bg-emerald-500",
  };
  return <button className={`${base} ${sizes[size]} ${variants[variant]} ${className}`} {...props} />;
}

function Field({ label, required, error, hint, children, className = "" }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-sm text-navy-400">
        {label} {required && <span className="text-gold-400">*</span>}
      </span>
      {children}
      {error && <span className="mt-1 block text-xs text-rose-400">{error}</span>}
      {!error && hint && <span className="mt-1 block text-xs text-navy-500">{hint}</span>}
    </label>
  );
}

const inputCls =
  "w-full rounded-lg border border-navy-700 bg-navy-800 px-3 py-2 text-sm text-navy-100 placeholder-navy-500 focus:border-gold-500 focus:outline-none focus:ring-1 focus:ring-gold-500";

function TextInput(props) {
  return <input {...props} className={`${inputCls} ${props.className || ""}`} />;
}
function RoundedSelect({ options, value, onChange, placeholder = "Selecione...", className = "" }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const ref = useRef(null);
  const btnRef = useRef(null);

  const opts = options.map((o) => (typeof o === "object" ? o : { value: o, label: o }));
  const selecionado = opts.find((o) => String(o.value) === String(value));

  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const calcPosition = () => {
    const r = btnRef.current.getBoundingClientRect();
    const popH = Math.min(260, opts.length * 38 + 12);
    let top = r.bottom + 6;
    if (top + popH > window.innerHeight - 8) top = Math.max(8, r.top - popH - 6);
    setCoords({ top, left: r.left, width: r.width });
  };

  const abrir = () => {
    if (!open) calcPosition();
    setOpen((o) => !o);
  };

  const escolher = (v) => {
    setOpen(false);
    onChange({ target: { value: v } });
  };

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button type="button" ref={btnRef} onClick={abrir} className={`${inputCls} flex items-center justify-between text-left`}>
        <span className={`truncate ${selecionado ? "text-navy-100" : "text-navy-500"}`}>{selecionado ? selecionado.label : placeholder}</span>
        <ChevronDown size={15} className="shrink-0 text-navy-500" />
      </button>
      {open && coords && (
        <div style={{ top: coords.top, left: coords.left, width: coords.width }} className="fixed z-50 max-h-64 overflow-y-auto rounded-xl border border-navy-800 bg-navy-900 p-1 shadow-2xl">
          {opts.map((o) => (
            <button type="button" key={o.value} onClick={() => escolher(o.value)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-navy-800 ${String(o.value) === String(value) ? "bg-gold-950 text-gold-300" : "text-navy-200"}`}>
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
function SelectInput({ options, placeholder, value, onChange, className }) {
  return <RoundedSelect options={options} value={value} onChange={onChange} placeholder={placeholder} className={className} />;
}

function CustomerSelect({ customers, value, onChange, placeholder = "Selecione o cliente" }) {
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState("");
  const [coords, setCoords] = useState(null);
  const ref = useRef(null);
  const btnRef = useRef(null);

  const sorted = useMemo(
    () => [...customers].sort((a, b) => String(a.code ?? "").localeCompare(String(b.code ?? ""), "pt-BR", { numeric: true })),
    [customers]
  );
  const selecionado = customers.find((c) => c.id === value);

  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const POP_H = 280;
  const calcPosition = () => {
    const r = btnRef.current.getBoundingClientRect();
    let top = r.bottom + 6;
    if (top + POP_H > window.innerHeight - 8) top = Math.max(8, r.top - POP_H - 6);
    setCoords({ top, left: r.left, width: r.width });
  };

  const abrir = () => {
    setBusca("");
    if (!open) calcPosition();
    setOpen((o) => !o);
  };

  const termo = busca.trim().toLowerCase();
  const filtrados = termo
    ? sorted.filter((c) => `${c.code} ${c.name}`.toLowerCase().includes(termo))
    : sorted;

  const escolher = (id) => { onChange(id); setOpen(false); };

  return (
    <div className="relative" ref={ref}>
      <button type="button" ref={btnRef} onClick={abrir} className={`${inputCls} flex items-center justify-between text-left`}>
        <span className={`truncate ${selecionado ? "text-navy-100" : "text-navy-500"}`}>
          {selecionado ? `${selecionado.code} · ${selecionado.name}` : placeholder}
        </span>
        <ChevronDown size={15} className="shrink-0 text-navy-500" />
      </button>
      {open && coords && (
        <div style={{ top: coords.top, left: coords.left, width: Math.max(coords.width, 260) }} className="fixed z-50 rounded-xl border border-navy-800 bg-navy-900 shadow-2xl">
          <div className="flex items-center gap-2 border-b border-navy-800 p-2">
            <Search size={14} className="shrink-0 text-navy-500" />
            <input autoFocus type="text" value={busca} onChange={(e) => setBusca(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && filtrados[0]) escolher(filtrados[0].id); }}
              placeholder="Buscar por código ou nome..."
              className="w-full bg-transparent text-sm text-navy-100 placeholder-navy-500 focus:outline-none" />
          </div>
          <div className="max-h-56 overflow-y-auto p-1">
            {filtrados.length === 0 && <div className="px-3 py-2 text-sm text-navy-500">Nenhum cliente encontrado.</div>}
            {filtrados.map((c) => (
              <button type="button" key={c.id} onClick={() => escolher(c.id)}
                className={`block w-full rounded-lg px-3 py-1.5 text-left text-sm hover:bg-navy-800 ${c.id === value ? "bg-gold-950 text-gold-300" : "text-navy-200"}`}>
                <span className="tabular-nums">{c.code}</span> · {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const WEEKDAYS_PT = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES_PT = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function DatePicker({ value, onChange, className = "", light = false, openRight = false }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const [texto, setTexto] = useState(() => (value ? fmtDate(value) : ""));
  const [view, setView] = useState(() => {
    if (value) {
      const [y, m] = value.split("-").map(Number);
      return { y, m: m - 1 };
    }
    const d = new Date();
    return { y: d.getFullYear(), m: d.getMonth() };
  });
  const ref = useRef(null);
  const btnRef = useRef(null);

  useEffect(() => {
    setTexto(value ? fmtDate(value) : "");
  }, [value]);

  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const digitar = (raw) => {
    const masked = maskDateBR(raw);
    setTexto(masked);
    const iso = parseDateBR(masked);
    if (iso) onChange(iso);
  };

  const POP_W = 256, POP_H = 340;
  const calcPosition = () => {
    const r = btnRef.current.getBoundingClientRect();
    const style = {};
    if (openRight) {
      let left = r.right + 8;
      if (left + POP_W > window.innerWidth - 8) left = r.left - POP_W - 8;
      style.left = Math.max(8, left);
      style.bottom = Math.max(8, window.innerHeight - r.bottom);
    } else {
      let top = r.bottom + 8;
      if (top + POP_H > window.innerHeight - 8) top = Math.max(8, r.top - POP_H - 8);
      style.top = top;
      let left = r.left;
      if (left + POP_W > window.innerWidth - 8) left = window.innerWidth - POP_W - 8;
      style.left = Math.max(8, left);
    }
    setCoords(style);
  };

  const abrir = () => {
    if (value) {
      const [y, m] = value.split("-").map(Number);
      setView({ y, m: m - 1 });
    }
    if (!open) calcPosition();
    setOpen((o) => !o);
  };

  const mudarMes = (delta) => {
    setView((v) => {
      let m = v.m + delta, y = v.y;
      if (m < 0) { m = 11; y--; } else if (m > 11) { m = 0; y++; }
      return { y, m };
    });
  };

  const isoDe = (d) => `${view.y}-${String(view.m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const escolher = (d) => { onChange(isoDe(d)); setOpen(false); };

  const diasNoMes = new Date(view.y, view.m + 1, 0).getDate();
  const primeiroDiaSemana = new Date(view.y, view.m, 1).getDay();
  const hojeISO = todayISO();
  const celulas = [];
  for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push(d);

  return (
    <div className="relative" ref={ref}>
      <div ref={btnRef}
        className={light
          ? `flex items-center gap-2 border-b-2 border-amber-400 bg-transparent px-1 py-1 ${className}`
          : `${inputCls} flex items-center gap-2 ${className}`}>
        <input type="text" inputMode="numeric" value={texto} onChange={(e) => digitar(e.target.value)}
          placeholder="dd/mm/aaaa"
          className={`w-full min-w-0 bg-transparent focus:outline-none ${light ? "text-lg font-medium placeholder-amber-400" : "placeholder-navy-500"} ${light ? (value ? "text-amber-900" : "text-amber-400") : (value ? "text-navy-100" : "text-navy-500")}`} />
        <button type="button" onClick={abrir} className="shrink-0">
          <Calendar size={15} className={light ? "text-amber-700" : "text-navy-500"} />
        </button>
      </div>
      {open && coords && (
        <div style={coords} className="fixed z-50 w-64 rounded-xl border border-navy-800 bg-navy-900 p-3 shadow-2xl">
          <div className="mb-2 flex items-center justify-between">
            <button type="button" onClick={() => mudarMes(-1)} className="rounded-lg p-1.5 text-navy-400 hover:bg-navy-800 hover:text-navy-100">
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm font-medium text-navy-100">{MESES_PT[view.m]} {view.y}</span>
            <button type="button" onClick={() => mudarMes(1)} className="rounded-lg p-1.5 text-navy-400 hover:bg-navy-800 hover:text-navy-100">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-navy-500">
            {WEEKDAYS_PT.map((w, i) => <div key={i} className="py-1">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {celulas.map((d, i) => {
              if (!d) return <div key={i} />;
              const iso = isoDe(d);
              const selecionado = iso === value;
              const hoje = iso === hojeISO;
              return (
                <button type="button" key={i} onClick={() => escolher(d)}
                  className={`aspect-square rounded-lg text-sm tabular-nums transition-colors ${selecionado ? "bg-gold-300 font-semibold text-navy-950" : hoje ? "border border-gold-500 text-gold-300" : "text-navy-300 hover:bg-navy-800"}`}>
                  {d}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-navy-800 pt-2">
            <button type="button" onClick={() => { const t = todayISO(); onChange(t); setOpen(false); }}
              className="text-xs font-medium text-gold-400 hover:text-gold-300">Hoje</button>
            {value && (
              <button type="button" onClick={() => { onChange(""); setOpen(false); }}
                className="text-xs text-navy-500 hover:text-navy-300">Limpar</button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Modal({ title, subtitle, onClose, children, wide }) {
  useEffect(() => {
    const h = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black bg-opacity-70 p-0 sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        className={`max-h-full w-full overflow-y-auto rounded-t-2xl border border-navy-800 bg-navy-900 p-5 shadow-2xl sm:rounded-2xl ${wide ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-navy-50">{title}</h3>
            {subtitle && <p className="mt-0.5 text-sm text-navy-400">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1 text-navy-500 hover:bg-navy-800 hover:text-navy-200">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function EmptyState({ title, hint, action }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-sm font-medium text-navy-300">{title}</p>
      {hint && <p className="max-w-sm text-sm text-navy-500">{hint}</p>}
      {action}
    </div>
  );
}

function Pagination({ page, pages, total, onPage, perPage, setPerPage }) {
  if (total === 0) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-navy-800 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <span className="text-xs text-navy-500">
          {total} {total === 1 ? "registro" : "registros"} · página {page} de {pages}
        </span>
        {setPerPage && (
          <label className="flex items-center gap-1.5 text-xs text-navy-500">
            Por página
            <RoundedSelect value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}
              options={[10, 25, 50]} className="w-16" />
          </label>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Btn variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={14} /> Anterior
        </Btn>
        <Btn variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          Próxima <ChevronRight size={14} />
        </Btn>
      </div>
    </div>
  );
}

function Dropdown({ button, children, align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      {button(() => setOpen((o) => !o), open)}
      {open && (
        <div className={`absolute z-40 mt-2 min-w-[220px] rounded-xl border border-navy-800 bg-navy-900 p-1.5 shadow-2xl ${align === "right" ? "right-0" : "left-0"}`}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

function SortHead({ children, col, sort, onSort, className = "" }) {
  const active = sort.col === col;
  return (
    <th className={`px-4 py-2.5 font-medium ${className}`}>
      <button onClick={() => onSort(col)} className={`inline-flex items-center gap-1 ${active ? "text-navy-100" : "text-navy-400 hover:text-navy-200"}`}>
        {children}
        <ArrowUpDown size={12} className={active ? "text-gold-400" : "text-navy-600"} />
      </button>
    </th>
  );
}

function ColumnPicker({ allCols, cols, setCols, onSaveCols, lockedKey }) {
  return (
    <Dropdown
      button={(t) => (
        <Btn variant="outline" onClick={t}>
          <Settings2 size={15} /> Colunas <ChevronDown size={14} />
        </Btn>
      )}
    >
      {(close) => (
        <div className="p-1">
          {allCols.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-navy-200 hover:bg-navy-800">
              <input type="checkbox" checked={cols.includes(c.key)} disabled={c.key === lockedKey}
                onChange={() => setCols(cols.includes(c.key) ? cols.filter((k) => k !== c.key) : [...allCols.map((x) => x.key).filter((k) => cols.includes(k) || k === c.key)])}
                className="h-4 w-4 rounded border-navy-600 bg-navy-800 accent-gold-400" />
              {c.label}
            </label>
          ))}
          <div className="mt-1 border-t border-navy-800 pt-1">
            <button onClick={() => { onSaveCols(); close(); }}
              className="flex w-full items-center justify-center gap-2 rounded-lg px-2.5 py-2 text-sm font-medium text-gold-300 hover:bg-navy-800">
              Salvar colunas
            </button>
          </div>
        </div>
      )}
    </Dropdown>
  );
}

/* ------------------------------------------------------------------ */
/* dashboard                                                           */
/* ------------------------------------------------------------------ */

function StatCard({ label, value, sub, onClick, accent }) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={`rounded-2xl border border-navy-800 bg-navy-900 p-4 text-left transition-colors ${onClick ? "hover:border-navy-700 hover:bg-navy-800" : ""}`}
    >
      <p className="text-xs text-navy-400">{label}</p>
      <p className={`mt-2 text-xl font-semibold tabular-nums ${accent || "text-navy-50"}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-navy-500">{sub}</p>}
    </Wrapper>
  );
}

function ChartTip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded-lg border border-navy-700 bg-navy-900 px-3 py-2 text-xs shadow-xl">
      <p className="text-navy-400">{payload[0].payload.labelFull || label}</p>
      <p className="mt-0.5 font-medium text-navy-100 tabular-nums">{BRL(payload[0].value)}</p>
    </div>
  );
}

function Dashboard({ db, hoje, go }) {
  const stats = useMemo(() => {
    let vencido = 0, hojeV = 0, futuro = 0;
    db.installments.forEach((i) => {
      const s = saldoOf(i);
      if (i.canceled || s <= 0) return;
      const d = daysBetween(hoje, i.dueDate);
      if (d < 0) vencido += s;
      else if (d === 0) hojeV += s;
      else futuro += s;
    });
    return {
      vencido, hoje: hojeV, futuro,
      total: vencido + hojeV + futuro,
      ativos: db.customers.filter((c) => c.active).length,
    };
  }, [db, hoje]);

  const vencimentos = useMemo(() => {
    const map = new Map();
    db.installments.forEach((i) => {
      const s = saldoOf(i);
      if (i.canceled || s <= 0) return;
      const d = daysBetween(hoje, i.dueDate);
      if (d < 0 || d > 60) return;
      map.set(i.dueDate, (map.get(i.dueDate) || 0) + s);
    });
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, valor]) => ({ date: date.slice(8, 10) + "/" + date.slice(5, 7), labelFull: fmtDate(date), valor: round2(valor) }));
  }, [db, hoje]);

  const porTipo = useMemo(() => {
    const map = new Map(TIPOS.map((t) => [t, 0]));
    const byContract = new Map(db.contracts.map((c) => [c.id, c.type]));
    db.installments.forEach((i) => {
      const s = saldoOf(i);
      if (i.canceled || s <= 0) return;
      const t = byContract.get(i.contractId);
      if (t && map.has(t)) map.set(t, map.get(t) + s);
    });
    return [...map.entries()].map(([tipo, valor]) => ({ tipo, valor: round2(valor) }));
  }, [db]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard label="Total vencido" value={BRL(stats.vencido)} accent="text-rose-400" sub="Clique para ver os contratos" onClick={() => go("contratos")} />
        <StatCard label="Vence hoje" value={BRL(stats.hoje)} accent="text-amber-400" sub={fmtDate(hoje)} onClick={() => go("contratos")} />
        <StatCard label="A vencer" value={BRL(stats.futuro)} sub="Parcelas futuras em aberto" onClick={() => go("contratos")} />
        <StatCard label="Total geral" value={BRL(stats.total)} accent="text-gold-300" sub="Saldo devedor da carteira" onClick={() => go("contratos")} />
        <StatCard label="Clientes ativos" value={stats.ativos} sub={`${db.customers.length} cadastrados`} onClick={() => go("clientes")} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-navy-800 bg-navy-900 p-4 lg:col-span-2">
          <div className="mb-4 flex items-baseline justify-between">
            <h3 className="text-sm font-semibold text-navy-100">Vencimentos dos próximos 60 dias</h3>
            <span className="text-xs text-navy-500">Passe o mouse para ver o valor do dia</span>
          </div>
          {vencimentos.length === 0 ? (
            <EmptyState title="Nenhum vencimento no período" hint="As parcelas geradas pelos contratos aparecem aqui." />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={vencimentos} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gv" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a3e635" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="#a3e635" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="#27272a" vertical={false} />
                  <XAxis dataKey="date" tick={{ fill: "#71717a", fontSize: 11 }} tickLine={false} axisLine={{ stroke: "#27272a" }} minTickGap={16} />
                  <YAxis tick={{ fill: "#71717a", fontSize: 11 }} tickLine={false} axisLine={false} width={64}
                    tickFormatter={(v) => (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)} />
                  <Tooltip content={<ChartTip />} cursor={{ stroke: "#3f3f46" }} />
                  <Area type="monotone" dataKey="valor" stroke="#a3e635" strokeWidth={2} fill="url(#gv)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-navy-800 bg-navy-900 p-4">
          <h3 className="mb-1 text-sm font-semibold text-navy-100">Saldo por tipo de contrato</h3>
          <p className="mb-4 text-xs text-navy-500">Clique em uma barra para filtrar os contratos</p>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porTipo} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="#27272a" horizontal={false} />
                <XAxis type="number" tick={{ fill: "#71717a", fontSize: 11 }} tickLine={false} axisLine={false}
                  tickFormatter={(v) => (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v)} />
                <YAxis type="category" dataKey="tipo" width={96} tick={{ fill: "#a1a1aa", fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTip />} cursor={{ fill: "#27272a" }} />
                <Bar dataKey="valor" radius={[0, 6, 6, 0]} onClick={(d) => go("contratos", { preset: d.tipo })} className="cursor-pointer">
                  {porTipo.map((d) => (
                    <Cell key={d.tipo} fill={TIPO_COR[d.tipo]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* clientes                                                            */
/* ------------------------------------------------------------------ */

const CUSTOMER_COLS = [
  { key: "code", label: "Código" },
  { key: "name", label: "Nome" },
  { key: "cpfCnpj", label: "CPF/CNPJ" },
  { key: "phone", label: "Telefone" },
  { key: "referral", label: "Indicado por" },
  { key: "city", label: "Cidade" },
  { key: "active", label: "Ativo" },
  { key: "createdBy", label: "Cadastrado por" },
];

function CustomersPage({ db, go, onDelete, cols, setCols, onSaveCols }) {
  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState("todos");
  const [sort, setSort] = useState({ col: "code", dir: 1 });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [confirm, setConfirm] = useState(null);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    let out = db.customers.filter((c) => {
      if (onlyActive === "ativos" && !c.active) return false;
      if (onlyActive === "inativos" && c.active) return false;
      if (!term) return true;
      return [c.name, c.cpfCnpj, c.phone, c.code, c.city].join(" ").toLowerCase().includes(term);
    });
    out = [...out].sort((a, b) => {
      const av = a[sort.col] ?? "", bv = b[sort.col] ?? "";
      return String(av).localeCompare(String(bv), "pt-BR", { numeric: true }) * sort.dir;
    });
    return out;
  }, [db.customers, q, onlyActive, sort]);

  const pages = Math.max(1, Math.ceil(rows.length / perPage));
  const view = rows.slice((page - 1) * perPage, page * perPage);
  useEffect(() => setPage(1), [q, onlyActive, perPage]);

  const toggleSort = (col) => setSort((s) => (s.col === col ? { col, dir: -s.dir } : { col, dir: 1 }));
  const contractsOf = (id) => db.contracts.filter((k) => k.customerId === id).length;

  const exportar = () => {
    exportCsv(
      `clientes-${todayISO()}.csv`,
      ["Código", "Nome", "CPF/CNPJ", "Telefone"],
      rows.map((c) => [c.code, c.name, c.cpfCnpj, c.phone]),
    );
  };

  return (
    <>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-navy-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nome, CPF/CNPJ, telefone ou código"
            className={`${inputCls} pl-9`} />
        </div>
        <RoundedSelect value={onlyActive} onChange={(e) => setOnlyActive(e.target.value)} className="sm:w-40"
          options={[{ value: "todos", label: "Todos" }, { value: "ativos", label: "Somente ativos" }, { value: "inativos", label: "Somente inativos" }]} />
        <ColumnPicker allCols={CUSTOMER_COLS} cols={cols} setCols={setCols} onSaveCols={onSaveCols} lockedKey="name" />
        <Btn variant="outline" onClick={exportar}><Download size={15} /> Exportar</Btn>
      </div>

      <div className="overflow-hidden rounded-2xl border border-navy-800 bg-navy-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-navy-800 text-xs uppercase text-navy-400">
              <tr>
                {CUSTOMER_COLS.filter((c) => cols.includes(c.key)).map((c) => (
                  <SortHead key={c.key} col={c.key} sort={sort} onSort={toggleSort}>{c.label}</SortHead>
                ))}
                <th className="px-4 py-2.5 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-800">
              {view.map((c) => (
                <tr key={c.id} className="hover:bg-navy-800">
                  {cols.includes("code") && <td className="px-4 py-3 tabular-nums text-navy-400">{c.code}</td>}
                  {cols.includes("name") && (
                    <td className="px-4 py-3">
                      <p className="font-medium text-navy-100">{c.name}</p>
                      <p className="text-xs text-navy-500">{contractsOf(c.id)} contrato(s)</p>
                    </td>
                  )}
                  {cols.includes("cpfCnpj") && <td className="px-4 py-3 tabular-nums text-navy-300">{c.cpfCnpj}</td>}
                  {cols.includes("phone") && <td className="px-4 py-3 tabular-nums text-navy-300">{c.phone}</td>}
                  {cols.includes("referral") && <td className="px-4 py-3 text-navy-400">{c.referral || "—"}</td>}
                  {cols.includes("city") && <td className="px-4 py-3 text-navy-300">{c.city}/{c.state}</td>}
                  {cols.includes("active") && <td className="px-4 py-3"><Badge>{c.active ? "Ativo" : "Inativo"}</Badge></td>}
                  {cols.includes("createdBy") && <td className="px-4 py-3 text-navy-400">{c.createdBy}</td>}
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      <button title="Novo contrato" onClick={() => go("contrato-novo", { customerId: c.id })}
                        className="rounded-lg p-1.5 text-navy-400 hover:bg-navy-700 hover:text-gold-300"><FileText size={15} /></button>
                      <button title="Editar" onClick={() => go("cliente-form", { customerId: c.id })}
                        className="rounded-lg p-1.5 text-navy-400 hover:bg-navy-700 hover:text-navy-100"><Pencil size={15} /></button>
                      <button title="Excluir" onClick={() => setConfirm(c)}
                        className="rounded-lg p-1.5 text-navy-400 hover:bg-navy-700 hover:text-rose-400"><Trash2 size={15} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <EmptyState
            title="Nenhum cliente encontrado"
            hint={q ? "Ajuste a busca ou os filtros." : "Cadastre o primeiro cliente para começar a criar contratos."}
            action={<Btn onClick={() => go("cliente-form", {})}><Plus size={15} /> Novo cliente</Btn>}
          />
        )}
        <Pagination page={page} pages={pages} total={rows.length} onPage={setPage} perPage={perPage} setPerPage={setPerPage} />
      </div>

      {confirm && (
        <Modal title="Excluir cliente?" subtitle={`${confirm.name} será removido do sistema.`} onClose={() => setConfirm(null)}>
          <div className="rounded-xl border border-amber-800 bg-amber-950 p-3 text-sm text-amber-300">
            <AlertTriangle size={16} className="mb-1 inline" />{" "}
            {contractsOf(confirm.id) > 0
              ? `Este cliente possui ${contractsOf(confirm.id)} contrato(s). Excluir também remove os contratos, parcelas e pagamentos vinculados.`
              : "Esta ação não pode ser desfeita."}
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="outline" onClick={() => setConfirm(null)}>Cancelar</Btn>
            <Btn variant="danger" onClick={() => { onDelete(confirm.id); setConfirm(null); }}>Excluir cliente</Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

/* formulário de cliente */
const emptyCustomer = () => ({
  code: "", cpfCnpj: "", name: "", referral: "", gender: "", maritalStatus: "", phone: "", email: "",
  cep: "", street: "", number: "", district: "", complement: "", city: "", state: "",
  fatherName: "", motherName: "", notes: "", active: true, contacts: [],
});

function CustomerForm({ initial, existing = [], onSave, onCancel }) {
  const [f, setF] = useState(initial || emptyCustomer());
  const [errors, setErrors] = useState({});
  const [cepState, setCepState] = useState("");
  const [contact, setContact] = useState({ name: "", phone: "" });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const buscarCep = async () => {
    const cep = onlyDigits(f.cep);
    if (cep.length !== 8) { setCepState("CEP deve ter 8 dígitos."); return; }
    setCepState("buscando");
    try {
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const d = await r.json();
      if (d.erro) { setCepState("CEP não encontrado."); return; }
      setF((p) => ({ ...p, street: d.logradouro || p.street, district: d.bairro || p.district, city: d.localidade || p.city, state: d.uf || p.state }));
      setCepState("Endereço preenchido automaticamente.");
    } catch {
      setCepState("Consulta indisponível agora. Preencha o endereço manualmente.");
    }
  };

  const submit = () => {
    const e = {};
    if (!f.code.trim()) e.code = "Informe o código do cliente.";
    else if (existing.some((c) => c.id !== f.id && c.code.trim().toLowerCase() === f.code.trim().toLowerCase())) e.code = "Já existe um cliente com esse código.";
    if (!f.name.trim()) e.name = "Informe o nome.";
    if (!f.cpfCnpj.trim()) e.cpfCnpj = "Informe o CPF ou CNPJ.";
    else if (!validDoc(f.cpfCnpj)) e.cpfCnpj = "Documento inválido — confira os dígitos.";
    else if (existing.some((c) => c.id !== f.id && onlyDigits(c.cpfCnpj) === onlyDigits(f.cpfCnpj))) {
      e.cpfCnpj = `Já existe um cliente com esse CPF/CNPJ (${existing.find((c) => onlyDigits(c.cpfCnpj) === onlyDigits(f.cpfCnpj))?.name}).`;
    }
    if (f.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) e.email = "E-mail inválido.";
    if (f.phone && onlyDigits(f.phone).length < 10) e.phone = "Telefone incompleto.";
    setErrors(e);
    if (Object.keys(e).length === 0) onSave(f);
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-navy-800 bg-navy-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-navy-100">Dados gerais</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Código do cliente" required error={errors.code} hint="Você define o código — usado para identificar o cliente nas listas">
            <TextInput value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="Ex.: 1004" />
          </Field>
          <Field label="CPF/CNPJ" required error={errors.cpfCnpj}>
            <TextInput value={f.cpfCnpj} onChange={(e) => set("cpfCnpj", maskCpfCnpj(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" />
          </Field>
          <Field label="Nome completo" required error={errors.name} className="lg:col-span-2">
            <TextInput value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="Nome do cliente ou razão social" />
          </Field>
          <Field label="Indicação" hint="Código de quem indicou este cliente">
            <TextInput value={f.referral} onChange={(e) => set("referral", e.target.value)} placeholder="Ex.: 1004" />
          </Field>
          <Field label="Sexo">
            <SelectInput value={f.gender} onChange={(e) => set("gender", e.target.value)} options={GENEROS} placeholder="Selecione o sexo" />
          </Field>
          <Field label="Estado civil">
            <SelectInput value={f.maritalStatus} onChange={(e) => set("maritalStatus", e.target.value)} options={ESTADO_CIVIL} />
          </Field>
          <Field label="Telefone" error={errors.phone}>
            <TextInput value={f.phone} onChange={(e) => set("phone", maskPhone(e.target.value))} placeholder="(44) 99999-9999" inputMode="numeric" />
          </Field>
          <Field label="E-mail" error={errors.email}>
            <TextInput value={f.email} onChange={(e) => set("email", e.target.value)} placeholder="cliente@email.com" />
          </Field>
          <Field label="Situação">
            <SelectInput value={f.active ? "Ativo" : "Inativo"} onChange={(e) => set("active", e.target.value === "Ativo")} options={["Ativo", "Inativo"]} placeholder="Ativo" />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-navy-800 bg-navy-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-navy-100">Endereço</h3>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="CEP" hint={cepState === "buscando" ? "Buscando endereço..." : cepState}>
            <div className="flex gap-2">
              <TextInput value={f.cep} onChange={(e) => set("cep", maskCep(e.target.value))} placeholder="87200-000" inputMode="numeric" />
              <Btn variant="outline" onClick={buscarCep} className="shrink-0">Buscar</Btn>
            </div>
          </Field>
          <Field label="Logradouro" className="lg:col-span-2">
            <TextInput value={f.street} onChange={(e) => set("street", e.target.value)} />
          </Field>
          <Field label="Número">
            <TextInput value={f.number} onChange={(e) => set("number", e.target.value)} inputMode="numeric" />
          </Field>
          <Field label="Bairro">
            <TextInput value={f.district} onChange={(e) => set("district", e.target.value)} />
          </Field>
          <Field label="Complemento">
            <TextInput value={f.complement} onChange={(e) => set("complement", e.target.value)} placeholder="Apto, sala, referência" />
          </Field>
          <Field label="Cidade">
            <TextInput value={f.city} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="Estado">
            <TextInput value={f.state} onChange={(e) => set("state", e.target.value.toUpperCase().slice(0, 2))} placeholder="PR" />
          </Field>
        </div>
      </section>

      <section className="rounded-2xl border border-navy-800 bg-navy-900 p-5">
        <h3 className="mb-1 text-sm font-semibold text-navy-100">Contatos</h3>
        <p className="mb-4 text-xs text-navy-500">Pessoas que podem ser acionadas sobre este cliente.</p>
        {f.contacts.length > 0 && (
          <ul className="mb-4 divide-y divide-navy-800 overflow-hidden rounded-xl border border-navy-800">
            {f.contacts.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="text-navy-200">{c.name}</span>
                <span className="ml-auto tabular-nums text-navy-400">{c.phone}</span>
                <button onClick={() => set("contacts", f.contacts.filter((x) => x.id !== c.id))}
                  className="rounded-lg p-1 text-navy-500 hover:bg-navy-800 hover:text-rose-400"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <TextInput value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder="Nome do contato" />
          <TextInput value={contact.phone} onChange={(e) => setContact({ ...contact, phone: maskPhone(e.target.value) })} placeholder="(44) 99999-9999" inputMode="numeric" />
          <Btn variant="outline" disabled={!contact.name.trim()}
            onClick={() => { set("contacts", [...f.contacts, { ...contact, id: "ct" + Date.now() }]); setContact({ name: "", phone: "" }); }}>
            <Plus size={15} /> Adicionar
          </Btn>
        </div>
      </section>

      <section className="rounded-2xl border border-navy-800 bg-navy-900 p-5">
        <h3 className="mb-4 text-sm font-semibold text-navy-100">Filiação e observações</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome do pai"><TextInput value={f.fatherName} onChange={(e) => set("fatherName", e.target.value)} /></Field>
          <Field label="Nome da mãe"><TextInput value={f.motherName} onChange={(e) => set("motherName", e.target.value)} /></Field>
          <Field label="Observações" className="sm:col-span-2">
            <textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={4}
              className={inputCls} placeholder="Informações adicionais sobre o cliente" />
          </Field>
        </div>
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Btn variant="outline" onClick={onCancel}>Cancelar</Btn>
        <Btn onClick={submit}>{initial ? "Salvar alterações" : "Cadastrar cliente"}</Btn>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* contratos                                                           */
/* ------------------------------------------------------------------ */

function useContractIndex(db, hoje) {
  return useMemo(() => {
    const byContract = new Map();
    db.installments.forEach((i) => {
      const arr = byContract.get(i.contractId) || [];
      arr.push(i);
      byContract.set(i.contractId, arr);
    });
    const pagoPorContrato = new Map();
    db.payments.filter((p) => p.kind !== "juros").forEach((p) => pagoPorContrato.set(p.contractId, round2((pagoPorContrato.get(p.contractId) || 0) + p.amount)));
    const info = new Map();
    db.contracts.forEach((k) => {
      const list = (byContract.get(k.id) || []).sort((a, b) => a.number - b.number);
      const valorContrato = round2(k.contractValue ?? k.requestedAmount);
      const pago = pagoPorContrato.get(k.id) || 0;
      const saldo = round2(Math.max(0, valorContrato - pago));
      const abertas = list.filter((i) => !i.canceled && saldoOf(i) > 0);
      const vencidas = abertas.filter((i) => daysBetween(hoje, i.dueDate) < 0);
      const prox = abertas.map((i) => i.dueDate).sort()[0] || null;
      info.set(k.id, {
        list, saldo, abertas: abertas.length, vencidas: vencidas.length,
        proximoVencimento: prox,
        status: abertas.length === 0 ? "Quitado" : "Em andamento",
        total: round2(list.reduce((s, i) => s + i.originalAmount, 0)),
      });
    });
    return info;
  }, [db, hoje]);
}

const CONTRACT_COLS = [
  { key: "number", label: "Cliente" },
  { key: "status", label: "Situação" },
  { key: "type", label: "Tipo" },
  { key: "beneficiary", label: "Beneficiário" },
  { key: "issueDate", label: "Emissão" },
  { key: "prox", label: "Próx. vencimento" },
  { key: "requestedAmount", label: "Valor original" },
  { key: "saldo", label: "Saldo devedor" },
];

function ContractsPage({ db, hoje, index, go, preset, cols, setCols, onSaveCols, onQuitar }) {
  const [q, setQ] = useState("");
  const [confirmQuitar, setConfirmQuitar] = useState(null);
  const [status, setStatus] = useState("Em andamento");
  const [tipo, setTipo] = useState(TIPOS.includes(preset) ? preset : "todos");
  const [venc, setVenc] = useState("todos");
  const [customDate, setCustomDate] = useState("");
  const [sort, setSort] = useState({ col: "prox", dir: 1 });
  const nameOf = (id) => db.customers.find((c) => c.id === id)?.name || "—";
  const codeOf = (id) => db.customers.find((c) => c.id === id)?.code || "—";
  const beneficiaryOf = (k) => k.beneficiaryName || nameOf(k.customerId);

  const term = q.trim().toLowerCase();

  const matches = useMemo(() => (k, overrides = {}) => {
    const st = overrides.status ?? status;
    const tp = overrides.tipo ?? tipo;
    const inf = index.get(k.id);
    if (st !== "todos" && inf.status !== st) return false;
    if (tp !== "todos" && k.type !== tp) return false;
    if (venc !== "todos") {
      if (!inf.proximoVencimento) return false;
      const d = daysBetween(hoje, inf.proximoVencimento);
      if (venc === "hoje" && d !== 0) return false;
      if (venc === "amanha" && d !== 1) return false;
      if (venc === "7" && (d < 0 || d > 7)) return false;
      if (venc === "30" && (d < 0 || d > 30)) return false;
      if (venc === "vencidos" && inf.vencidas === 0) return false;
      if (venc === "data" && inf.proximoVencimento !== customDate) return false;
    }
    if (!term) return true;
    if (String(codeOf(k.customerId)).toLowerCase() === term) return true;
    return [k.type, nameOf(k.customerId), beneficiaryOf(k)].join(" ").toLowerCase().includes(term);
  }, [status, tipo, venc, customDate, term, index, hoje, db.customers]);

  const counts = useMemo(() => {
    const c = { "Em andamento": 0, "Quitado": 0, tipos: { "Crédito pessoal": 0, "Duplicata": 0, "Cheque": 0 } };
    db.contracts.forEach((k) => {
      if (matches(k, { status: "Em andamento" })) c["Em andamento"]++;
      if (matches(k, { status: "Quitado" })) c["Quitado"]++;
      TIPOS.forEach((t) => { if (matches(k, { tipo: t })) c.tipos[t]++; });
    });
    return c;
  }, [db.contracts, matches]);

  const rows = useMemo(() => {
    const out = db.contracts.filter((k) => matches(k));
    const val = (k, col) => {
      const inf = index.get(k.id);
      if (col === "beneficiary") return beneficiaryOf(k);
      if (col === "saldo") return inf.saldo;
      if (col === "status") return inf.status;
      if (col === "prox") return inf.proximoVencimento || "9999";
      return k[col];
    };
    return [...out].sort((a, b) => {
      const av = val(a, sort.col), bv = val(b, sort.col);
      if (typeof av === "number") return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv), "pt-BR", { numeric: true }) * sort.dir;
    });
  }, [db.contracts, index, matches, sort]);

  const toggleSort = (col) => setSort((s) => (s.col === col ? { col, dir: -s.dir } : { col, dir: 1 }));
  const totalSaldo = useMemo(() => rows.reduce((s, k) => s + index.get(k.id).saldo, 0), [rows, index]);

  return (
    <>
      <div className="mb-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative flex-1">
            <Search size={15} className="pointer-events-none absolute left-3 top-2.5 text-navy-500" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nº do contrato, cliente ou finalidade" className={`${inputCls} pl-9`} />
          </div>
          <RoundedSelect value={venc} onChange={(e) => setVenc(e.target.value)} className="sm:w-56"
            options={[
              { value: "todos", label: "Próximo vencimento: todos" },
              { value: "vencidos", label: "Com parcelas vencidas" },
              { value: "hoje", label: "Vence hoje" },
              { value: "amanha", label: "Vence amanhã" },
              { value: "7", label: "Próximos 7 dias" },
              { value: "30", label: "Próximos 30 dias" },
              { value: "data", label: "Data específica..." },
            ]} />
          {venc === "data" && (
            <DatePicker value={customDate} onChange={setCustomDate} className="sm:w-44" />
          )}
          <ColumnPicker allCols={CONTRACT_COLS} cols={cols} setCols={setCols} onSaveCols={onSaveCols} lockedKey="number" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Dropdown
            button={(t) => (
              <Btn variant="outline" onClick={t}>
                Situação: {status === "todos" ? "Todas" : status} <ChevronDown size={14} />
              </Btn>
            )}
          >
            {(close) => (
              <div className="p-1">
                {[["todos", "Todas", undefined], ["Em andamento", "Em andamento", counts["Em andamento"]], ["Quitado", "Quitado", counts["Quitado"]]].map(([val, label, count]) => (
                  <button key={val} onClick={() => { setStatus(val); close(); }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm ${status === val ? "bg-navy-800 text-gold-300" : "text-navy-200 hover:bg-navy-800"}`}>
                    {label}
                    {count !== undefined && <span className="tabular-nums text-xs text-navy-500">{count}</span>}
                  </button>
                ))}
              </div>
            )}
          </Dropdown>
          <Dropdown
            button={(t) => (
              <Btn variant="outline" onClick={t}>
                Tipo: {tipo === "todos" ? "Todos" : tipo} <ChevronDown size={14} />
              </Btn>
            )}
          >
            {(close) => (
              <div className="p-1">
                <button onClick={() => { setTipo("todos"); close(); }}
                  className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm ${tipo === "todos" ? "bg-navy-800 text-gold-300" : "text-navy-200 hover:bg-navy-800"}`}>
                  Todos
                </button>
                {TIPOS.map((t) => (
                  <button key={t} onClick={() => { setTipo(t); close(); }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-sm ${tipo === t ? "bg-navy-800 text-gold-300" : "text-navy-200 hover:bg-navy-800"}`}>
                    {t}
                    <span className="tabular-nums text-xs text-navy-500">{counts.tipos[t]}</span>
                  </button>
                ))}
              </div>
            )}
          </Dropdown>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-navy-800 bg-navy-900">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-navy-800 text-xs uppercase text-navy-400">
              <tr>
                {cols.includes("number") && <SortHead col="number" sort={sort} onSort={toggleSort}>Cliente</SortHead>}
                {cols.includes("status") && <SortHead col="status" sort={sort} onSort={toggleSort}>Situação</SortHead>}
                {cols.includes("type") && <SortHead col="type" sort={sort} onSort={toggleSort}>Tipo</SortHead>}
                {cols.includes("beneficiary") && <SortHead col="beneficiary" sort={sort} onSort={toggleSort}>Beneficiário</SortHead>}
                {cols.includes("issueDate") && <SortHead col="issueDate" sort={sort} onSort={toggleSort}>Emissão</SortHead>}
                {cols.includes("prox") && <SortHead col="prox" sort={sort} onSort={toggleSort}>Próx. vencimento</SortHead>}
                {cols.includes("requestedAmount") && <SortHead col="requestedAmount" sort={sort} onSort={toggleSort} className="text-right">Valor original</SortHead>}
                <th className="px-2 py-2.5"></th>
                {cols.includes("saldo") && <SortHead col="saldo" sort={sort} onSort={toggleSort} className="text-right">Saldo devedor</SortHead>}
              </tr>
            </thead>
            <tbody className="divide-y divide-navy-800">
              {rows.map((k) => {
                const inf = index.get(k.id);
                return (
                  <tr key={k.id} onClick={() => go("contrato", { contractId: k.id })} className="cursor-pointer hover:bg-navy-800">
                    {cols.includes("number") && (
                      <td className="px-4 py-3">
                        <p className="text-base font-semibold tabular-nums text-navy-100">{codeOf(k.customerId)}</p>
                        <p className="text-xs text-navy-500">{nameOf(k.customerId)}</p>
                      </td>
                    )}
                    {cols.includes("status") && (
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <button title={inf.status === "Quitado" ? "Contrato já quitado" : "Quitar contrato"}
                            disabled={inf.status === "Quitado"}
                            onClick={(e) => { e.stopPropagation(); setConfirmQuitar(k.id); }}
                            className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full shadow-lg transition-colors ${inf.status === "Quitado" ? "cursor-default bg-navy-700 text-navy-400" : "bg-gradient-to-br from-[#FBE9A0] via-[#D4AF37] to-[#8A6A22] text-amber-950 shadow-amber-950 hover:from-[#FFF3C4] hover:via-[#E8C15E] hover:to-[#9C7A29]"}`}>
                            <DollarSign size={14} strokeWidth={2.5} />
                          </button>
                          <div>
                            <Badge>{inf.status}</Badge>
                            {inf.vencidas > 0 && <p className="mt-1 text-xs text-rose-400">{inf.vencidas} vencida(s)</p>}
                          </div>
                        </div>
                      </td>
                    )}
                    {cols.includes("type") && <td className="px-4 py-3"><Badge>{k.type}</Badge></td>}
                    {cols.includes("beneficiary") && <td className="px-4 py-3 text-navy-300">{beneficiaryOf(k)}</td>}
                    {cols.includes("issueDate") && <td className="px-4 py-3 tabular-nums text-navy-400">{fmtDate(k.issueDate)}</td>}
                    {cols.includes("prox") && <td className="px-4 py-3 tabular-nums text-navy-400">{fmtDate(inf.proximoVencimento)}</td>}
                    {cols.includes("requestedAmount") && <td className="px-4 py-3 text-right tabular-nums text-navy-300">{BRL(k.requestedAmount)}</td>}
                    <td className="px-2 py-3" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const cliente = db.customers.find((c) => c.id === k.customerId);
                        const link = linkWhatsappContrato(cliente, beneficiaryOf(k), inf, hoje);
                        return link ? (
                          <a href={link} target="_blank" rel="noopener noreferrer" title="Chamar no WhatsApp"
                            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366] text-white shadow hover:brightness-110">
                            <MessageCircle size={15} />
                          </a>
                        ) : (
                          <span title="Cliente sem telefone cadastrado" className="flex h-8 w-8 items-center justify-center rounded-full bg-navy-800 text-navy-600">
                            <MessageCircle size={15} />
                          </span>
                        );
                      })()}
                    </td>
                    {cols.includes("saldo") && <td className="px-4 py-3 text-right font-medium tabular-nums text-navy-100">{BRL(inf.saldo)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && (
          <EmptyState title="Nenhum contrato encontrado" hint="Ajuste os filtros ou crie um novo contrato."
            action={<Btn onClick={() => go("contrato-novo", {})}><Plus size={15} /> Novo contrato</Btn>} />
        )}
      </div>
      <div className="h-16" />

      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between border-t border-gold-800 bg-navy-900 px-4 py-3 text-sm shadow-2xl sm:px-6 lg:left-60">
        <span className="text-navy-400">{rows.length} contrato(s)</span>
        <span className="font-medium text-navy-200">
          Saldo devedor total: <span className="tabular-nums font-semibold text-gold-300">{BRL(totalSaldo)}</span>
        </span>
      </div>

      {confirmQuitar && (
        <Modal title="Quitar contrato?" subtitle="Tem certeza que vai quitar esse contrato?" onClose={() => setConfirmQuitar(null)}>
          <div className="rounded-xl border border-amber-800 bg-amber-950 p-3 text-sm text-amber-300">
            <AlertTriangle size={16} className="mb-1 inline" />{" "}
            As parcelas em aberto serão baixadas automaticamente e o saldo devedor vai a zero. Esta ação não pode ser desfeita.
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="outline" onClick={() => setConfirmQuitar(null)}>Cancelar</Btn>
            <Btn onClick={() => { onQuitar(confirmQuitar); setConfirmQuitar(null); }}
              className="!bg-none !bg-gradient-to-br !from-[#FBE9A0] !via-[#D4AF37] !to-[#8A6A22] !text-amber-950 hover:!from-[#FFF3C4] hover:!via-[#E8C15E] hover:!to-[#9C7A29]">
              Quitar contrato
            </Btn>
          </div>
        </Modal>
      )}
    </>
  );
}

/* assistente de contrato — 4 etapas */
const STEPS = ["Solicitação", "Simulação", "Apresentação", "Fechamento"];

function ContractWizard({ db, onFinish, onCancel, presetCustomer }) {
  const [step, setStep] = useState(0);
  const [f, setF] = useState({
    customerId: presetCustomer || "",
    issueDate: todayISO(),
    beneficiaryName: "",
    type: "",
    requestedAmount: "",
    installmentCount: "",
    interestRate: "4.00",
    firstPaymentDate: addMonths(todayISO(), 1),
  });
  const [calc, setCalc] = useState(null);
  const [parcelaInput, setParcelaInput] = useState("");
  const [contratoInput, setContratoInput] = useState("");
  const [errors, setErrors] = useState({});
  const [confirm, setConfirm] = useState(false);
  const set = (k, v) => { setF((p) => ({ ...p, [k]: v })); setCalc(null); };
  const cliente = db.customers.find((c) => c.id === f.customerId);

  const validate = (s) => {
    const e = {};
    if (s === 0) {
      if (!f.customerId) e.customerId = "Selecione o cliente pagador.";
      if (!f.type) e.type = "Selecione o tipo de contrato.";
      if (!(Number(f.requestedAmount) > 0)) e.requestedAmount = "O valor deve ser maior que zero.";
      if (!f.issueDate) e.issueDate = "Informe a data de emissão.";
      if (!(Number(f.installmentCount) >= 1)) e.installmentCount = "Informe a quantidade de parcelas.";
    }
    if (s === 1) {
      const r = Number(f.interestRate);
      if (!(r >= 0 && r <= 100)) e.interestRate = "Taxa deve estar entre 0% e 100% ao mês.";
      if (!calc) e.calc = "Execute o cálculo antes de continuar.";
    }
    if (s === 3) {
      if (!f.firstPaymentDate) e.firstPaymentDate = "Informe a data do primeiro pagamento.";
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const calcular = () => {
    const taxa = Number(f.interestRate);
    if (!(taxa >= 0 && taxa <= 100)) {
      setErrors({ interestRate: "Taxa deve estar entre 0% e 100% ao mês." });
      return;
    }
    const pv = Number(f.requestedAmount);
    const i = Number(f.interestRate) / 100;
    const n = Math.round(Number(f.installmentCount));
    const parcela = round2(pmt(pv, i, n));
    const rows = buildSchedule(pv, Number(f.interestRate), n, f.firstPaymentDate, parcela);
    const total = round2(rows.reduce((s, r) => s + r.originalAmount, 0));
    const valorContrato = round2(pv * (1 + i));
    setErrors({});
    setCalc({ n, parcela, rows, total, juros: round2(total - pv), pv, valorContrato });
    setParcelaInput(String(parcela));
    setContratoInput(String(valorContrato));
  };

  const ajustarContrato = (raw) => {
    setContratoInput(raw);
    const valorContrato = round2(Number(raw));
    if (!calc || !(valorContrato > 0)) return;
    setCalc((c) => ({ ...c, valorContrato }));
  };

  const ajustarParcela = (raw) => {
    setParcelaInput(raw);
    const parcela = round2(Number(raw));
    if (!calc || !(parcela > 0)) return;
    const rows = buildFlatSchedule(calc.pv, calc.n, parcela, f.firstPaymentDate);
    const total = round2(parcela * calc.n);
    setCalc((c) => ({ ...c, parcela, rows, total, juros: round2(total - c.pv) }));
  };

  useEffect(() => {
    if (calc) {
      const rows = calc.rows.map((r, idx) => ({ ...r, dueDate: addMonths(f.firstPaymentDate, idx) }));
      setCalc((c) => ({ ...c, rows }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.firstPaymentDate]);

  const next = () => { if (validate(step)) setStep((s) => Math.min(3, s + 1)); };
  const back = () => { setErrors({}); setStep((s) => Math.max(0, s - 1)); };

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-2">
        {STEPS.map((s, idx) => (
          <li key={s} className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${idx === step ? "border-gold-500 bg-gold-950 text-gold-300" : idx < step ? "border-navy-700 text-navy-300" : "border-navy-800 text-navy-600"}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-xs tabular-nums ${idx < step ? "bg-gold-300 text-navy-950" : idx === step ? "bg-gold-300 text-navy-950" : "bg-navy-800 text-navy-500"}`}>
              {idx < step ? "✓" : idx + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <section className="rounded-2xl border border-navy-800 bg-navy-900 p-5">
        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Cliente pagador" required error={errors.customerId}>
              <CustomerSelect customers={db.customers} value={f.customerId} onChange={(id) => set("customerId", id)} />
            </Field>
            <Field label="Beneficiário" hint="Quem receberá os recursos — deixe em branco para usar o cliente pagador">
              <TextInput value={f.beneficiaryName} onChange={(e) => set("beneficiaryName", e.target.value)} placeholder="Nome do beneficiário" />
            </Field>
            <Field label="Data de emissão" required error={errors.issueDate}>
              <DatePicker value={f.issueDate} onChange={(v) => set("issueDate", v)} />
            </Field>
            <Field label="Tipo de contrato" required error={errors.type}>
              <SelectInput value={f.type} onChange={(e) => {
                const novoTipo = e.target.value;
                set("type", novoTipo);
                if (novoTipo === "Duplicata") set("installmentCount", "1");
                else if (f.type === "Duplicata") set("installmentCount", "");
              }} options={WIZARD_TIPOS} placeholder="Selecione o tipo" />
            </Field>
            <Field label="Valor solicitado" required error={errors.requestedAmount}>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-navy-500">R$</span>
                <TextInput type="number" min="0" step="0.01" value={f.requestedAmount} onChange={(e) => set("requestedAmount", e.target.value)} placeholder="10.000,00" className="pl-10" />
              </div>
            </Field>
            <Field label="Quantidade de parcelas" required error={errors.installmentCount}
              hint={f.type === "Duplicata" ? "Duplicata é sempre parcela única" : undefined}>
              <TextInput type="number" min="1" max="120" step="1" value={f.installmentCount}
                onChange={(e) => set("installmentCount", e.target.value)}
                disabled={f.type === "Duplicata"} placeholder="12" />
            </Field>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Taxa de juros" required error={errors.interestRate} hint="Ao mês, sobre o saldo devedor">
                <div className="flex items-center gap-2">
                  <TextInput type="number" min="0" max="100" step="0.01" value={f.interestRate} onChange={(e) => set("interestRate", e.target.value)} />
                  <span className="text-sm text-navy-400">% a.m.</span>
                </div>
              </Field>
              <Field label="Base de cálculo">
                <TextInput value={BRL(Number(f.requestedAmount))} readOnly className="text-navy-400" />
              </Field>
              <div className="flex items-end">
                <Btn onClick={calcular} className="w-full">Calcular</Btn>
              </div>
            </div>
            {errors.calc && <p className="text-sm text-rose-400">{errors.calc}</p>}
            {!calc ? (
              <div className="rounded-xl border border-dashed border-navy-700 px-6 py-10 text-center text-sm text-navy-500">
                Aguardando o cálculo. Confirme a taxa e clique em Calcular.
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <StatCard label="Parcelas" value={`${calc.n}x`} />
                  <div className="rounded-2xl border border-navy-800 bg-navy-900 p-4 text-left">
                    <p className="text-xs text-navy-400">Valor da parcela</p>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-sm font-semibold text-gold-300">R$</span>
                      <input type="number" min="0" step="0.01" value={parcelaInput} onChange={(e) => ajustarParcela(e.target.value)}
                        className="w-full border-none bg-transparent p-0 text-xl font-semibold tabular-nums text-gold-300 focus:outline-none focus:ring-0" />
                    </div>
                    <p className="mt-1 text-xs text-navy-500">Editável — ajusta o total</p>
                  </div>
                  <StatCard label="Total a pagar (parcelado)" value={BRL(calc.total)} />
                  <div className="rounded-2xl border border-navy-800 bg-navy-900 p-4 text-left">
                    <p className="text-xs text-navy-400">Valor do contrato (à vista)</p>
                    <div className="mt-2 flex items-baseline gap-1">
                      <span className="text-sm font-semibold text-sky-400">R$</span>
                      <input type="number" min="0" step="0.01" value={contratoInput} onChange={(e) => ajustarContrato(e.target.value)}
                        className="w-full border-none bg-transparent p-0 text-xl font-semibold tabular-nums text-sky-400 focus:outline-none focus:ring-0" />
                    </div>
                    <p className="mt-1 text-xs text-navy-500">Editável — usado no saldo devedor</p>
                  </div>
                </div>
                <ScheduleTable rows={calc.rows} />
              </>
            )}
          </div>
        )}

        {step === 2 && calc && (
          <div className="space-y-5">
            <div className="grid gap-5 lg:grid-cols-3">
              <div>
                <h4 className="mb-2 text-sm font-semibold text-navy-100">Cliente</h4>
                <p className="text-sm text-navy-300">{cliente?.name}</p>
                <p className="text-xs text-navy-500">{cliente?.cpfCnpj}</p>
                <p className="text-xs text-navy-500">{cliente?.phone}</p>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-semibold text-navy-100">Contrato</h4>
                <p className="text-sm text-navy-300">{f.type}</p>
                <p className="text-xs text-navy-500">Beneficiário: {f.beneficiaryName || cliente?.name}</p>
                <p className="text-xs text-navy-500">Emissão {fmtDate(f.issueDate)}</p>
              </div>
              <div>
                <h4 className="mb-2 text-sm font-semibold text-navy-100">Plano de pagamento</h4>
                <p className="text-sm text-navy-300">{calc.n}x de {BRL(calc.parcela)}</p>
                <p className="text-xs text-navy-500">Primeiro vencimento em {fmtDate(f.firstPaymentDate)}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <StatCard label="Valor pego" value={BRL(calc.pv)} />
              <StatCard label="Taxa de juros" value={`${Number(f.interestRate).toFixed(2)}% a.m.`} />
              <StatCard label="Total a pagar (parcelado)" value={BRL(calc.total)} accent="text-gold-300" />
              <StatCard label="Valor do contrato (à vista)" value={BRL(calc.valorContrato)} accent="text-sky-400" />
            </div>
            <ScheduleTable rows={calc.rows} />
          </div>
        )}

        {step === 3 && calc && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Data do primeiro pagamento" required error={errors.firstPaymentDate}>
                <DatePicker value={f.firstPaymentDate} onChange={(v) => setF((p) => ({ ...p, firstPaymentDate: v }))} />
              </Field>
              <div className="rounded-xl border border-navy-800 bg-navy-800 p-4 text-sm text-navy-300">
                <p>{cliente?.name}</p>
                <p className="mt-1 tabular-nums text-navy-400">{calc.n}x de {BRL(calc.parcela)} · total {BRL(calc.total)}</p>
                <p className="mt-1 text-xs text-navy-500">Última parcela em {fmtDate(addMonths(f.firstPaymentDate, calc.n - 1))}</p>
              </div>
            </div>
            <ScheduleTable rows={calc.rows} />
          </div>
        )}
      </section>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
        <Btn variant="ghost" onClick={step === 0 ? onCancel : back}>
          <ArrowLeft size={15} /> {step === 0 ? "Cancelar" : "Voltar"}
        </Btn>
        {step < 3 ? (
          <Btn onClick={next}>Continuar <ChevronRight size={15} /></Btn>
        ) : (
          <Btn onClick={() => validate(3) && setConfirm(true)}>Finalizar contrato</Btn>
        )}
      </div>

      {confirm && (
        <Modal title="Finalizar contrato?" onClose={() => setConfirm(false)}
          subtitle="O sistema criará o contrato, gerará todas as parcelas e lançará as contas a receber.">
          <div className="space-y-1 rounded-xl border border-navy-800 bg-navy-800 p-4 text-sm text-navy-300">
            <p>{cliente?.name}</p>
            <p className="tabular-nums text-navy-400">{f.type} · {BRL(Number(f.requestedAmount))} · {calc.n}x de {BRL(calc.parcela)}</p>
            <p className="text-xs text-navy-500">Primeiro vencimento {fmtDate(f.firstPaymentDate)}</p>
            <p className="text-xs text-navy-500">Valor do contrato à vista: <span className="tabular-nums text-navy-300">{BRL(calc.valorContrato)}</span></p>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="outline" onClick={() => setConfirm(false)}>Cancelar</Btn>
            <Btn onClick={() => onFinish(f, calc)}>Finalizar contrato</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ScheduleTable({ rows }) {
  const [all, setAll] = useState(false);
  const view = all ? rows : rows.slice(0, 6);
  return (
    <div className="overflow-hidden rounded-xl border border-navy-800">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-sm">
          <thead className="border-b border-navy-800 bg-navy-800 text-xs uppercase text-navy-400">
            <tr>
              <th className="px-4 py-2.5 font-medium">Parcela</th>
              <th className="px-4 py-2.5 font-medium">Vencimento</th>
              <th className="px-4 py-2.5 text-right font-medium">Valor</th>
              <th className="px-4 py-2.5 text-right font-medium">Juros</th>
              <th className="px-4 py-2.5 font-medium">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-navy-800">
            {view.map((r) => (
              <tr key={r.number}>
                <td className="px-4 py-2.5 tabular-nums text-navy-300">{String(r.number).padStart(2, "0")}</td>
                <td className="px-4 py-2.5 tabular-nums text-navy-300">{fmtDate(r.dueDate)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-navy-100">{BRL(r.originalAmount)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-navy-400">{BRL(0)}</td>
                <td className="px-4 py-2.5"><Badge>Aberto</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 6 && (
        <button onClick={() => setAll(!all)} className="w-full border-t border-navy-800 py-2 text-xs text-navy-400 hover:bg-navy-800 hover:text-navy-200">
          {all ? "Mostrar menos" : `Ver todas as ${rows.length} parcelas`}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* lançar cheque                                                       */
/* ------------------------------------------------------------------ */

function ChequeForm({ db, onFinish, onCancel }) {
  const [customerId, setCustomerId] = useState("");
  const [issuerName, setIssuerName] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(addMonths(todayISO(), 1));
  const [errors, setErrors] = useState({});
  const [fila, setFila] = useState([]);
  const [revisao, setRevisao] = useState(null);

  const cliente = db.customers.find((c) => c.id === customerId);

  const selecionarCliente = (id) => {
    setCustomerId(id);
    const c = db.customers.find((x) => x.id === id);
    if (c && !issuerName.trim()) setIssuerName(c.name);
  };

  const validar = () => {
    const e = {};
    if (!customerId) e.customerId = "Selecione o cliente.";
    if (!issuerName.trim()) e.issuerName = "Informe o nome do emitente.";
    if (!(Number(amount) > 0)) e.amount = "Informe o valor do cheque.";
    if (!dueDate) e.dueDate = "Informe a data para liquidar.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const itemAtual = () => ({
    id: "q" + Date.now() + Math.random(),
    customerId, customerLabel: `${cliente?.code} · ${cliente?.name}`,
    issuerName: issuerName.trim(), amount: round2(Number(amount)), dueDate,
  });

  const adicionarNaFila = () => {
    if (!validar()) return;
    setFila((f) => [...f, itemAtual()]);
    setAmount("");
    setIssuerName(cliente?.name || "");
    setDueDate(addMonths(todayISO(), 1));
    setErrors({});
  };

  const removerDaFila = (id) => setFila((f) => f.filter((x) => x.id !== id));

  const formTemDados = customerId || issuerName.trim() || amount;

  const abrirRevisao = () => {
    let lista = fila;
    if (formTemDados) {
      if (!validar()) return;
      lista = [...fila, itemAtual()];
    }
    if (lista.length === 0) { setErrors({ customerId: "Adicione pelo menos um cheque antes de lançar." }); return; }
    setRevisao(lista);
  };

  const totalPendente = fila.length + (formTemDados ? 1 : 0);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-end">
        <Btn onClick={abrirRevisao}><Landmark size={15} /> Lançar cheques{totalPendente > 0 ? ` (${totalPendente})` : ""}</Btn>
      </div>

      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <div className="order-2 lg:order-1">
          <h3 className="mb-2 text-sm font-semibold text-navy-100">Lista de espera{fila.length > 0 ? ` (${fila.length})` : ""}</h3>
          {fila.length === 0 ? (
            <p className="text-xs text-navy-500">Os cheques que você adicionar com o + aparecem aqui, aguardando serem lançados junto.</p>
          ) : (
            <div className="max-h-[70vh] space-y-2 overflow-y-auto pr-1">
              {fila.map((c) => (
                <div key={c.id} className="group relative overflow-hidden rounded-lg border border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100 px-3 py-2 text-navy-900 shadow">
                  <button type="button" onClick={() => removerDaFila(c.id)}
                    className="absolute right-1 top-1 rounded-full p-0.5 text-amber-700 hover:bg-amber-200">
                    <X size={12} />
                  </button>
                  <p className="truncate pr-4 text-[11px] text-amber-700">{c.customerLabel}</p>
                  <div className="mt-0.5 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{c.issuerName}</span>
                    <span className="shrink-0 text-sm font-bold">{BRL(c.amount)}</span>
                  </div>
                  <p className="text-[11px] text-amber-700">Liquidar {fmtDate(c.dueDate)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="order-1 space-y-5 lg:order-2">
          <section className="rounded-2xl border border-navy-800 bg-navy-900 p-5">
            <Field label="Cliente" required error={errors.customerId} hint="O emitente abaixo já preenche com o nome do cliente, mas pode ser alterado">
              <CustomerSelect customers={db.customers} value={customerId} onChange={selecionarCliente} />
            </Field>
          </section>

          <div className="relative mx-auto max-w-2xl">
            <div className="absolute inset-0 translate-x-2 translate-y-2 rotate-1 rounded-2xl border-2 border-amber-200 bg-amber-50" />
            <div className="absolute inset-0 translate-x-1 translate-y-1 -rotate-1 rounded-2xl border-2 border-amber-300 bg-amber-50" />
            <button type="button" onClick={adicionarNaFila} title="Adicionar cheque à lista de espera"
              className="absolute -right-3 -top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-gold-300 text-navy-950 shadow-lg hover:bg-gold-200">
              <Plus size={18} />
            </button>

            <div className="relative rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100 px-8 py-5 text-navy-900 shadow-2xl">
              <div className="flex items-start justify-between border-b-2 border-dashed border-amber-300 pb-3">
                <div className="flex items-center gap-2">
                  <Landmark size={20} className="text-amber-900" />
                  <div>
                    <p className="text-lg font-bold tracking-wide text-amber-900">BANCO ROMA</p>
                    <p className="text-xs text-amber-700">Agência 0001 · Conta-corrente</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-amber-700">Emissão</p>
                  <p className="tabular-nums text-sm font-medium text-amber-900">{fmtDate(todayISO())}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-4">
                <p className="max-w-[55%] text-sm text-amber-800">Pague por este cheque a quantia de</p>
                <div className="text-right">
                  <p className="text-xs text-amber-700">Valor</p>
                  <div className="flex items-center justify-end gap-1">
                    <span className="text-lg font-bold text-amber-900">R$</span>
                    <input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)}
                      className="w-32 border-b-2 border-amber-400 bg-transparent text-right text-xl font-bold text-amber-900 placeholder-amber-400 focus:outline-none" placeholder="0,00" />
                  </div>
                </div>
              </div>

              <div className="mt-5 flex items-center gap-3">
                <p className="shrink-0 text-xs text-amber-700">Nome do emitente</p>
                <input value={issuerName} onChange={(e) => setIssuerName(e.target.value)}
                  className="w-full border-b-2 border-amber-400 bg-transparent text-lg font-medium text-amber-900 placeholder-amber-400 focus:outline-none" placeholder="Nome de quem emite o cheque" />
              </div>

              <div className="mt-6 flex items-end justify-between gap-4">
                <div className="min-w-0">
                  {issuerName.trim() ? (
                    <p className="truncate font-signature text-4xl leading-tight text-amber-900">{issuerName}</p>
                  ) : (
                    <p className="text-sm text-amber-400">assinatura aparece aqui</p>
                  )}
                  <p className="mt-0.5 text-xs text-amber-700">assinatura (meramente ilustrativa)</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-xs text-amber-700">Bom para liquidar em</p>
                  <DatePicker value={dueDate} onChange={setDueDate} light openRight className="w-36" />
                </div>
              </div>

              <div className="mt-5 border-t-2 border-dashed border-amber-300 pt-2 text-center text-[10px] tracking-[0.2em] text-amber-500">
                ⑆ 000123456 ⑆ 0001 ⑆ 00045678-9 ⑆
              </div>
            </div>
          </div>

          {(errors.customerId || errors.amount || errors.issuerName || errors.dueDate) && (
            <p className="mx-auto max-w-2xl text-sm text-rose-400">
              {errors.customerId || errors.amount || errors.issuerName || errors.dueDate}
            </p>
          )}

          <div className="mx-auto flex max-w-2xl justify-start">
            <Btn variant="outline" onClick={onCancel}>Cancelar</Btn>
          </div>
        </div>
      </div>

      {revisao && (
        <ChequeReviewModal lista={revisao} onClose={() => setRevisao(null)} onConfirm={onFinish} />
      )}
    </div>
  );
}

function ChequeReviewModal({ lista, onClose, onConfirm }) {
  const [idx, setIdx] = useState(0);
  const [enviando, setEnviando] = useState(false);
  const c = lista[idx];

  const confirmar = async () => {
    setEnviando(true);
    await onConfirm(lista);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl border border-navy-800 bg-navy-900 p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-center text-lg font-semibold text-navy-50">Os cheques estão certos?</h3>
        <p className="mt-1 text-center text-sm text-navy-400">{idx + 1} de {lista.length}</p>

        <div className="mt-5 flex items-center gap-3">
          <button type="button" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-navy-700 text-navy-300 hover:bg-navy-800 disabled:opacity-30">
            <ChevronLeft size={18} />
          </button>

          <div className="flex-1 rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100 px-6 py-4 text-navy-900 shadow-xl">
            <p className="text-xs text-amber-700">{c.customerLabel}</p>
            <div className="mt-2 flex items-center justify-between gap-4">
              <p className="max-w-[55%] text-sm text-amber-800">Pague por este cheque a quantia de</p>
              <p className="text-xl font-bold text-amber-900">{BRL(c.amount)}</p>
            </div>
            <div className="mt-4 flex items-end justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate font-signature text-3xl leading-tight text-amber-900">{c.issuerName}</p>
                <p className="text-xs text-amber-700">emitente</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-xs text-amber-700">Bom para liquidar em</p>
                <p className="text-lg font-medium tabular-nums text-amber-900">{fmtDate(c.dueDate)}</p>
              </div>
            </div>
          </div>

          <button type="button" onClick={() => setIdx((i) => Math.min(lista.length - 1, i + 1))} disabled={idx === lista.length - 1}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-navy-700 text-navy-300 hover:bg-navy-800 disabled:opacity-30">
            <ChevronRight size={18} />
          </button>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <Btn variant="outline" onClick={onClose} disabled={enviando}>Voltar e corrigir</Btn>
          <Btn onClick={confirmar} disabled={enviando}>
            {enviando ? "Lançando..." : `Confirmar${lista.length > 1 ? ` e lançar (${lista.length})` : " e lançar"}`}
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* detalhe do cheque                                                   */
/* ------------------------------------------------------------------ */

function ChequeDetail({ db, hoje, contract, index, go, onTornarDuplicata, onPostergarCheque, onDelete, onQuitar }) {
  const inf = index.get(contract.id);
  const cliente = db.customers.find((c) => c.id === contract.customerId);
  const inst = inf.list[0];
  const emitente = contract.issuerName || contract.beneficiaryName;
  const [confirmDuplicata, setConfirmDuplicata] = useState(false);
  const [postergarOpen, setPostergarOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmQuitar, setConfirmQuitar] = useState(false);
  const quitado = inf.status === "Quitado";

  return (
    <div className="space-y-5">
      <div className="mx-auto max-w-3xl rounded-2xl border-2 border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100 px-8 py-5 text-navy-900 shadow-2xl">
        <div className="flex items-start justify-between border-b-2 border-dashed border-amber-300 pb-3">
          <div className="flex items-center gap-2">
            <Landmark size={20} className="text-amber-900" />
            <div>
              <p className="text-lg font-bold tracking-wide text-amber-900">BANCO ROMA</p>
              <p className="text-xs text-amber-700">Agência 0001 · Conta-corrente</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-amber-700">Emissão</p>
            <p className="tabular-nums text-sm font-medium text-amber-900">{fmtDate(contract.issueDate)}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="max-w-[55%] text-sm text-amber-800">Pague por este cheque a quantia de</p>
          <div className="text-right">
            <p className="text-xs text-amber-700">Valor</p>
            <p className="text-xl font-bold text-amber-900">{BRL(contract.requestedAmount)}</p>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-xs text-amber-700">Nome do emitente</p>
          <p className="text-lg font-medium text-amber-900">{emitente}</p>
        </div>

        <div className="mt-6 flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="truncate font-signature text-4xl leading-tight text-amber-900">{emitente}</p>
            <p className="mt-0.5 text-xs text-amber-700">assinatura (meramente ilustrativa)</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-xs text-amber-700">Bom para liquidar em</p>
            <p className="text-lg font-medium tabular-nums text-amber-900">{fmtDate(inst?.dueDate)}</p>
          </div>
        </div>

        <div className="mt-5 border-t-2 border-dashed border-amber-300 pt-2 text-center text-[10px] tracking-[0.2em] text-amber-500">
          ⑆ 000123456 ⑆ 0001 ⑆ 00045678-9 ⑆
        </div>
      </div>

      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 rounded-2xl border border-navy-800 bg-navy-900 p-4">
        <div className="text-sm text-navy-300">
          <p className="font-medium text-navy-100">{cliente?.name}</p>
          <div className="mt-1"><Badge>{inst ? instStatus(inst, hoje) : "Aberto"}</Badge></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Btn variant="ghost" onClick={() => setConfirmDel(true)}><Trash2 size={14} /> Excluir</Btn>
          <Btn variant="outline" onClick={() => setPostergarOpen(true)} disabled={quitado}>Postergar</Btn>
          <Btn onClick={() => setConfirmDuplicata(true)} disabled={quitado}>Torná-lo uma duplicata</Btn>
          <Btn variant="success" onClick={() => setConfirmQuitar(true)} disabled={quitado}>
            <CheckCircle2 size={14} /> {quitado ? "Já liquidado" : "Liquidar cheque"}
          </Btn>
        </div>
      </div>

      {confirmQuitar && (
        <Modal title="Liquidar cheque?" subtitle="O cheque será marcado como pago e o saldo devedor vai a zero." onClose={() => setConfirmQuitar(false)}>
          <div className="rounded-xl border border-emerald-800 bg-emerald-950 p-3 text-sm text-emerald-300">
            <CheckCircle2 size={16} className="mb-1 inline" />{" "}
            Confirma o recebimento de {BRL(inf.saldo)} de {cliente?.name} referente a este cheque?
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="outline" onClick={() => setConfirmQuitar(false)}>Cancelar</Btn>
            <Btn variant="success" onClick={() => { onQuitar(contract.id); setConfirmQuitar(false); }}>Confirmar liquidação</Btn>
          </div>
        </Modal>
      )}

      {confirmDuplicata && (
        <Modal title="Transformar em duplicata?" subtitle="Aviso: essa ação não pode ser desfeita." onClose={() => setConfirmDuplicata(false)}>
          <div className="rounded-xl border border-amber-800 bg-amber-950 p-3 text-sm text-amber-300">
            <AlertTriangle size={16} className="mb-1 inline" />{" "}
            O contrato deixa de ser um cheque e passa a ser uma duplicata, com o mesmo valor e cliente. A emissão passa a ser hoje ({fmtDate(hoje)}), com vencimento em {fmtDate(inst?.dueDate)} — a mesma data que estava marcada para liquidar o cheque.
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="outline" onClick={() => setConfirmDuplicata(false)}>Cancelar</Btn>
            <Btn onClick={() => { onTornarDuplicata(contract.id); setConfirmDuplicata(false); }}>Confirmar</Btn>
          </div>
        </Modal>
      )}

      {postergarOpen && inst && (
        <PostergarChequeModal installment={inst} contract={contract}
          onClose={() => setPostergarOpen(false)}
          onConfirm={(p) => { onPostergarCheque(p); setPostergarOpen(false); }} />
      )}

      {confirmDel && (
        <Modal title="Excluir cheque?" subtitle="Este cheque será removido do sistema." onClose={() => setConfirmDel(false)}>
          <div className="rounded-xl border border-amber-800 bg-amber-950 p-3 text-sm text-amber-300">
            <AlertTriangle size={16} className="mb-1 inline" /> Esta ação não pode ser desfeita.
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="outline" onClick={() => setConfirmDel(false)}>Cancelar</Btn>
            <Btn variant="danger" onClick={() => { onDelete(contract.id); go("contratos"); }}>Excluir</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PostergarChequeModal({ installment, contract, onClose, onConfirm }) {
  const [valor, setValor] = useState("");
  const [novaData, setNovaData] = useState(installment.dueDate);
  const [method, setMethod] = useState("PIX");
  const [error, setError] = useState("");

  const confirmar = () => {
    if (!novaData) { setError("Escolha a nova data."); return; }
    onConfirm({ installmentId: installment.id, contractId: contract.id, customerId: contract.customerId, novaData, jurosValor: Number(valor) || 0, method });
  };

  return (
    <Modal title="Postergar cheque" subtitle="Escolha o novo prazo e, se for o caso, o juros pago agora." onClose={onClose}>
      <div className="space-y-4">
        <Field label="Valor do juros" hint="Opcional">
          <TextInput type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} placeholder="0,00" />
        </Field>
        <Field label="Nova data" required>
          <DatePicker value={novaData} onChange={setNovaData} />
        </Field>
        <Field label="Forma de pagamento">
          <SelectInput value={method} onChange={(e) => setMethod(e.target.value)} options={METODOS} />
        </Field>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={confirmar}>Postergar</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* detalhe do contrato */
function ContractDetail({ db, hoje, contract, index, go, onPay, onDelete, onUpdateValue, onUpdateBeneficiary, onPagarJuros, onPostergarLivre, onNovoVencimento, onRecalcularParcelas, onUpdateDuplicataDueDate }) {
  const inf = index.get(contract.id);
  const cliente = db.customers.find((c) => c.id === contract.customerId);
  const benefName = contract.beneficiaryName || cliente?.name;
  const [editandoBenef, setEditandoBenef] = useState(false);
  const [benefInput, setBenefInput] = useState(benefName);
  const salvarBenef = () => {
    const nome = benefInput.trim();
    if (nome && nome !== benefName) onUpdateBeneficiary(contract.id, nome);
    setEditandoBenef(false);
  };
  const [payTarget, setPayTarget] = useState(null);
  const [jurosTarget, setJurosTarget] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [novoVencOpen, setNovoVencOpen] = useState(false);
  const [recalcularOpen, setRecalcularOpen] = useState(false);
  const [tab, setTab] = useState("parcelas");
  const pagamentos = db.payments.filter((p) => p.contractId === contract.id).sort((a, b) => b.date.localeCompare(a.date));
  const historico = db.audit.filter((a) => a.entityId === contract.id).sort((a, b) => b.at.localeCompare(a.at));
  const pagoContrato = round2(pagamentos.filter((p) => p.kind !== "juros").reduce((s, p) => s + p.amount, 0));
  const jurosPagoContrato = round2(pagamentos.filter((p) => p.kind === "juros").reduce((s, p) => s + p.amount, 0));
  const jurosDe = (installmentId) => round2(pagamentos.filter((p) => p.installmentId === installmentId && p.kind === "juros").reduce((s, p) => s + p.amount, 0));
  const [saldoInput, setSaldoInput] = useState(() => String(inf.saldo));
  useEffect(() => { setSaldoInput(String(inf.saldo)); }, [inf.saldo]);
  const ajustarSaldo = (raw) => {
    setSaldoInput(raw);
    const novoSaldo = Number(raw);
    if (!(novoSaldo >= 0)) return;
    onUpdateValue(contract.id, round2(novoSaldo + pagoContrato));
  };
  const linkWhats = linkWhatsappContrato(cliente, benefName, inf, hoje);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-navy-800 bg-navy-900 p-5 lg:col-span-2">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs text-navy-500">Beneficiário</p>
              {editandoBenef ? (
                <div className="flex items-center gap-1.5">
                  <input autoFocus value={benefInput} onChange={(e) => setBenefInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") salvarBenef(); if (e.key === "Escape") setEditandoBenef(false); }}
                    className="rounded-lg border border-navy-700 bg-navy-800 px-2 py-1 text-xl font-semibold text-navy-100 focus:border-gold-500 focus:outline-none" />
                  <button onClick={salvarBenef} className="rounded-lg p-1 text-gold-400 hover:bg-navy-800"><CheckCircle2 size={15} /></button>
                  <button onClick={() => setEditandoBenef(false)} className="rounded-lg p-1 text-navy-500 hover:bg-navy-800"><X size={15} /></button>
                </div>
              ) : (
                <h2 className="flex items-center gap-1.5 text-xl font-semibold text-navy-50">
                  {benefName}
                  <button onClick={() => { setBenefInput(benefName); setEditandoBenef(true); }} className="text-navy-500 hover:text-gold-400">
                    <Pencil size={13} />
                  </button>
                </h2>
              )}
              <p className="mt-1 text-sm text-navy-400">Cliente: {cliente?.name}</p>
            </div>
            <Badge>{inf.status}</Badge>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-y-3 text-sm">
            <div><dt className="text-xs text-navy-500">Tipo</dt><dd><Badge>{contract.type}</Badge></dd></div>
            <div><dt className="text-xs text-navy-500">Emissão</dt><dd className="tabular-nums text-navy-200">{fmtDate(contract.issueDate)}</dd></div>
            <div><dt className="text-xs text-navy-500">Cadastrado por</dt><dd className="text-navy-200">{contract.createdBy}</dd></div>
            <div>
              <dt className="text-xs text-navy-500">WhatsApp</dt>
              <dd>
                {linkWhats ? (
                  <a href={linkWhats} target="_blank" rel="noopener noreferrer" title="Chamar no WhatsApp"
                    className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-[#25D366] text-white shadow hover:brightness-110">
                    <MessageCircle size={15} />
                  </a>
                ) : (
                  <span title="Cliente sem telefone cadastrado" className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-full bg-navy-800 text-navy-600">
                    <MessageCircle size={15} />
                  </span>
                )}
              </dd>
            </div>
            {(contract.type === "Duplicata" || inf.abertas > 0) && (
              <div>
                <dt className="text-xs text-navy-500">Vencimento</dt>
                <dd>
                  <DatePicker
                    value={contract.type === "Duplicata" ? inf.list[0]?.dueDate : inf.proximoVencimento}
                    onChange={(v) => {
                      if (contract.type === "Duplicata") onUpdateDuplicataDueDate(contract.id, inf.list[0].id, v);
                      else onNovoVencimento(contract.id, v);
                    }}
                    className="!py-1.5 !text-sm"
                  />
                </dd>
              </div>
            )}
          </dl>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Btn onClick={() => setPayTarget(inf.list.find((i) => saldoOf(i) > 0) || null)} disabled={inf.abertas === 0}
              className="px-5 py-2.5 text-base">
              <Wallet size={16} /> Registrar pagamento
            </Btn>
            {contract.type === "Crédito pessoal" && (
              <>
                <Btn size="sm" variant="outline" onClick={() => setNovoVencOpen(true)}>Novo Vencimento</Btn>
                <Btn size="sm" variant="outline" onClick={() => setRecalcularOpen(true)}>Recalcular Parcelas</Btn>
              </>
            )}
            <Btn size="sm" variant="ghost" onClick={() => setConfirmDel(true)}><Trash2 size={14} /> Excluir</Btn>
          </div>
        </div>
        <div className="grid gap-3 lg:col-span-2 lg:grid-cols-2">
          <StatCard label="Valor pego" value={BRL(contract.requestedAmount)} />
          <StatCard label="Taxa de juros" value={`${contract.interestRate.toFixed(2)}% a.m.`} />
          <StatCard label="Parcelas" value={`${inf.list.length - inf.abertas}/${inf.list.length} pagas`} sub={`${BRL(contract.installmentAmount)} por parcela`} />
          <StatCard label="Valor do contrato" value={BRL(inf.total)} sub="Montante total parcelado" />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-navy-800 bg-navy-900 p-6 lg:col-span-2">
          <p className="text-sm text-navy-400">Saldo devedor</p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className={`text-2xl font-bold ${inf.vencidas > 0 ? "text-rose-400" : "text-gold-300"}`}>R$</span>
            <input type="number" min="0" step="0.01" value={saldoInput} onChange={(e) => ajustarSaldo(e.target.value)}
              className={`w-full border-none bg-transparent p-0 text-4xl font-bold tabular-nums focus:outline-none focus:ring-0 ${inf.vencidas > 0 ? "text-rose-400" : "text-gold-300"}`} />
          </div>
          <p className="mt-2 text-xs text-navy-500">{inf.vencidas > 0 ? `${inf.vencidas} parcela(s) vencida(s)` : "Em dia"} · editável</p>
        </div>
        <StatCard label="Valor pago" value={BRL(pagoContrato)} accent="text-gold-400" sub="Soma das parcelas recebidas" />
        <StatCard label="Juros pago" value={BRL(jurosPagoContrato)} accent="text-amber-400" sub="Soma dos juros recebidos" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-navy-800 bg-navy-900">
        <div className="flex gap-1 border-b border-navy-800 p-2">
          {[["parcelas", "Parcelas"], ["pagamentos", `Pagamentos (${pagamentos.length})`], ["historico", "Histórico"]].map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className={`rounded-lg px-3 py-1.5 text-sm ${tab === id ? "bg-navy-800 text-navy-100" : "text-navy-400 hover:text-navy-200"}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === "parcelas" && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="border-b border-navy-800 text-xs uppercase text-navy-400">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Parcela</th>
                  <th className="px-4 py-2.5 font-medium">Vencimento</th>
                  <th className="px-4 py-2.5 text-right font-medium">Valor</th>
                  <th className="px-4 py-2.5 text-right font-medium">Juros</th>
                  <th className="px-4 py-2.5 text-right font-medium">Pago</th>
                  <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                  <th className="px-4 py-2.5 font-medium">Situação</th>
                  <th className="px-4 py-2.5 text-right font-medium">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-800">
                {inf.list.map((i) => {
                  const st = instStatus(i, hoje);
                  const saldoParcela = contract.type === "Duplicata" ? inf.saldo : saldoOf(i);
                  return (
                    <tr key={i.id} className="hover:bg-navy-800">
                      <td className="px-4 py-2.5 tabular-nums text-navy-300">{String(i.number).padStart(2, "0")}</td>
                      <td className="px-4 py-2.5 tabular-nums text-navy-300">{fmtDate(i.dueDate)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-navy-100">{BRL(i.originalAmount)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-amber-400">{BRL(jurosDe(i.id))}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-gold-400">{BRL(i.paidAmount)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-navy-300">{BRL(saldoParcela)}</td>
                      <td className="px-4 py-2.5"><Badge>{st}</Badge></td>
                      <td className="px-4 py-2.5 text-right">
                        {saldoOf(i) > 0 && (
                          <div className="flex justify-end gap-1.5">
                            <Btn size="sm" variant="outline" onClick={() => setPayTarget(i)}>Receber</Btn>
                            <Btn size="sm" variant="ghost" onClick={() => setJurosTarget(i)}
                              className="!border !border-amber-700 !text-amber-300 hover:!bg-amber-950">Pagou juros</Btn>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {tab === "pagamentos" && (
          pagamentos.length === 0 ? (
            <EmptyState title="Nenhum pagamento registrado" hint="Os recebimentos deste contrato aparecerão aqui." />
          ) : (
            <ul className="divide-y divide-navy-800">
              {pagamentos.map((p) => {
                const inst = db.installments.find((i) => i.id === p.installmentId);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
                    <div>
                      <p className="text-navy-200">
                        Parcela {String(inst?.number || "?").padStart(2, "0")} · {p.method}
                        {p.kind === "juros" && <span className="ml-1.5 text-xs text-amber-400">(juros)</span>}
                      </p>
                      <p className="text-xs text-navy-500">{fmtDate(p.date)} · registrado por {p.createdBy}</p>
                    </div>
                    <span className="tabular-nums font-medium text-gold-400">{BRL(p.amount)}</span>
                  </li>
                );
              })}
            </ul>
          )
        )}

        {tab === "historico" && (
          <ul className="divide-y divide-navy-800">
            {historico.map((a) => (
              <li key={a.id} className="px-4 py-3 text-sm">
                <p className="text-navy-200">{a.action}</p>
                <p className="text-xs text-navy-500">{a.detail}</p>
                <p className="mt-0.5 text-xs text-navy-600">{fmtDateTime(a.at)} · {a.user}</p>
              </li>
            ))}
          </ul>
        )}
      </div>

      {payTarget && (
        <PaymentModal db={db} hoje={hoje} installment={payTarget} contract={contract}
          onClose={() => setPayTarget(null)} onConfirm={(p) => { onPay(p); setPayTarget(null); }} />
      )}
      {jurosTarget && contract.type === "Duplicata" && (
        <PostergarChequeModal installment={jurosTarget} contract={contract}
          onClose={() => setJurosTarget(null)}
          onConfirm={(p) => { onPostergarLivre(p); setJurosTarget(null); }} />
      )}
      {jurosTarget && contract.type !== "Duplicata" && (
        <InterestPaymentModal db={db} hoje={hoje} installment={jurosTarget} contract={contract}
          onClose={() => setJurosTarget(null)}
          onConfirm={(p) => { onPagarJuros(p); setJurosTarget(null); }} />
      )}
      {confirmDel && (
        <Modal title="Excluir contrato?" subtitle={`O contrato #${contract.number}, suas parcelas e pagamentos serão removidos.`} onClose={() => setConfirmDel(false)}>
          <div className="rounded-xl border border-amber-800 bg-amber-950 p-3 text-sm text-amber-300">
            <AlertTriangle size={16} className="mb-1 inline" /> Esta ação não pode ser desfeita.
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Btn variant="outline" onClick={() => setConfirmDel(false)}>Cancelar</Btn>
            <Btn variant="danger" onClick={() => { onDelete(contract.id); go("contratos"); }}>Excluir contrato</Btn>
          </div>
        </Modal>
      )}
      {novoVencOpen && (
        <NovoVencimentoModal
          onClose={() => setNovoVencOpen(false)}
          onConfirm={(novaData) => { onNovoVencimento(contract.id, novaData); setNovoVencOpen(false); }} />
      )}
      {recalcularOpen && (
        <RecalcularParcelasModal contract={contract} inf={inf}
          onClose={() => setRecalcularOpen(false)}
          onConfirm={(novoValor, novaQtd) => { onRecalcularParcelas(contract.id, novoValor, novaQtd); setRecalcularOpen(false); }} />
      )}
    </div>
  );
}

function NovoVencimentoModal({ onClose, onConfirm }) {
  const [data, setData] = useState("");
  const [error, setError] = useState("");

  const confirmar = () => {
    if (!data) { setError("Escolha a nova data."); return; }
    onConfirm(data);
  };

  return (
    <Modal title="Novo vencimento" subtitle="Muda o dia de vencimento de todas as parcelas em aberto deste contrato." onClose={onClose} wide>
      <div className="space-y-4">
        <Field label="Nova data de vencimento" required error={error}
          hint="O dia escolhido vale para todas as parcelas em aberto, cada uma no seu mês">
          <DatePicker value={data} onChange={(v) => { setData(v); setError(""); }} />
        </Field>
        <div className="flex justify-end gap-2">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={confirmar}>Confirmar</Btn>
        </div>
      </div>
    </Modal>
  );
}

function RecalcularParcelasModal({ contract, inf, onClose, onConfirm }) {
  const [valor, setValor] = useState(String(contract.installmentAmount || ""));
  const [qtd, setQtd] = useState(String(inf.abertas || ""));
  const [errors, setErrors] = useState({});

  const confirmar = () => {
    const e = {};
    if (!(Number(valor) > 0)) e.valor = "Informe o novo valor da parcela.";
    if (!(Number(qtd) >= 1)) e.qtd = "Informe a quantidade de parcelas.";
    setErrors(e);
    if (Object.keys(e).length === 0) onConfirm(round2(Number(valor)), Math.round(Number(qtd)));
  };

  return (
    <Modal title="Recalcular parcelas" subtitle="As parcelas já pagas continuam como estão. As parcelas em aberto são substituídas pelas novas." onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-800 bg-amber-950 p-3 text-sm text-amber-300">
          <AlertTriangle size={16} className="mb-1 inline" />{" "}
          {inf.list.length - inf.abertas} parcela(s) já paga(s) não mudam. As {inf.abertas} parcela(s) em aberto serão substituídas.
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Novo valor da parcela" required error={errors.valor}>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-2.5 text-sm text-navy-500">R$</span>
              <TextInput type="number" min="0" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="pl-10" />
            </div>
          </Field>
          <Field label="Quantidade de parcelas" required error={errors.qtd}>
            <TextInput type="number" min="1" max="120" step="1" value={qtd} onChange={(e) => setQtd(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={confirmar}>Recalcular</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* pagamento                                                           */
/* ------------------------------------------------------------------ */

function PaymentModal({ db, hoje, installment, contract, onClose, onConfirm }) {
  const saldo = saldoOf(installment);
  const [amount, setAmount] = useState(String(saldo));
  const [juros, setJuros] = useState("");
  const [date, setDate] = useState(hoje);
  const [method, setMethod] = useState("PIX");
  const [error, setError] = useState("");
  const cliente = db.customers.find((c) => c.id === contract.customerId);
  const v = Number(amount);
  const jv = Number(juros) || 0;

  const confirmar = () => {
    if (!(v > 0)) { setError("O valor da parcela deve ser maior que zero."); return; }
    if (v > saldo + 0.004) { setError(`O valor não pode ultrapassar o saldo da parcela (${BRL(saldo)}).`); return; }
    if (jv < 0) { setError("O valor do juros não pode ser negativo."); return; }
    if (!date) { setError("Informe a data do pagamento."); return; }
    onConfirm({ installmentId: installment.id, contractId: contract.id, customerId: contract.customerId, parcelaAmount: round2(v), jurosAmount: round2(jv), date, method });
  };

  return (
    <Modal title="Registrar pagamento" subtitle={`${cliente?.name} · contrato #${contract.number} · parcela ${String(installment.number).padStart(2, "0")}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 rounded-xl border border-navy-800 bg-navy-800 p-3 text-center text-xs">
          <div><p className="text-navy-500">Valor da parcela</p><p className="mt-1 tabular-nums text-navy-100">{BRL(installment.originalAmount)}</p></div>
          <div><p className="text-navy-500">Já pago</p><p className="mt-1 tabular-nums text-gold-400">{BRL(installment.paidAmount)}</p></div>
          <div><p className="text-navy-500">Vencimento</p><p className="mt-1 tabular-nums text-navy-100">{fmtDate(installment.dueDate)}</p></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor da parcela" required>
            <TextInput type="number" min="0" step="0.01" value={amount} onChange={(e) => { setAmount(e.target.value); setError(""); }} />
          </Field>
          <Field label="Valor do juros" hint="Opcional — se o cliente pagou juros junto">
            <TextInput type="number" min="0" step="0.01" value={juros} onChange={(e) => { setJuros(e.target.value); setError(""); }} placeholder="0,00" />
          </Field>
          <Field label="Data do pagamento" required>
            <DatePicker value={date} onChange={setDate} />
          </Field>
          <Field label="Forma de pagamento">
            <SelectInput value={method} onChange={(e) => setMethod(e.target.value)} options={METODOS} />
          </Field>
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={confirmar}>Registrar pagamento</Btn>
        </div>
      </div>
    </Modal>
  );
}

function InterestPaymentModal({ db, hoje, installment, contract, onClose, onConfirm }) {
  const [valor, setValor] = useState("");
  const [date, setDate] = useState(hoje);
  const [method, setMethod] = useState("PIX");
  const [error, setError] = useState("");
  const cliente = db.customers.find((c) => c.id === contract.customerId);
  const jv = Number(valor) || 0;

  const base = { installmentId: installment.id, contractId: contract.id, customerId: contract.customerId, date, method, valor: round2(jv) };

  const registrar = () => {
    if (!(jv > 0)) { setError("Informe o valor do juros pago."); return; }
    if (!date) { setError("Informe a data do pagamento."); return; }
    onConfirm({ ...base, postergar: false });
  };

  const postergar = () => {
    if (!date) { setError("Informe a data do pagamento."); return; }
    onConfirm({ ...base, postergar: true });
  };

  return (
    <Modal title="Pagou juros" subtitle={`${cliente?.name} · contrato #${contract.number} · parcela ${String(installment.number).padStart(2, "0")}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 rounded-xl border border-navy-800 bg-navy-800 p-3 text-center text-xs">
          <div><p className="text-navy-500">Valor da parcela</p><p className="mt-1 tabular-nums text-navy-100">{BRL(installment.originalAmount)}</p></div>
          <div><p className="text-navy-500">Vencimento</p><p className="mt-1 tabular-nums text-navy-100">{fmtDate(installment.dueDate)}</p></div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Valor do juros pago" required>
            <TextInput type="number" min="0" step="0.01" value={valor} onChange={(e) => { setValor(e.target.value); setError(""); }} placeholder="0,00" />
          </Field>
          <Field label="Data do pagamento" required>
            <DatePicker value={date} onChange={setDate} />
          </Field>
          <Field label="Forma de pagamento" className="sm:col-span-2">
            <SelectInput value={method} onChange={(e) => setMethod(e.target.value)} options={METODOS} />
          </Field>
        </div>
        <div className="rounded-xl border border-amber-800 bg-amber-950 p-3 text-xs text-amber-300">
          <AlertTriangle size={14} className="mb-1 inline" />{" "}
          Postergar joga esta parcela para um mês após a última parcela do contrato — o cliente só paga o juros agora e a parcela em si fica para depois.
        </div>
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
          <Btn variant="outline" onClick={postergar}>Postergar parcela</Btn>
          <Btn onClick={registrar}>Registrar juros</Btn>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* aplicação                                                           */
/* ------------------------------------------------------------------ */

const NAV = [
  { id: "resumo", label: "Resumo", icon: LayoutDashboard },
  { id: "clientes", label: "Clientes", icon: Users },
  { id: "contratos", label: "Contratos", icon: FileText },
];

const COLS_KEY = "sge-colunas-v1";
const DEFAULT_CUSTOMER_COLS = ["code", "name", "cpfCnpj", "phone", "city", "active", "createdBy"];
const DEFAULT_CONTRACT_COLS = ["number", "status", "type", "beneficiary", "issueDate", "prox", "requestedAmount", "saldo"];

function SplashScreen({ onEnter }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-navy-950 px-6 text-center">
      <img src={logoPrimeiraTela} alt="Banco Di'Roma" className="w-full max-w-xs sm:max-w-sm"
        style={{ mixBlendMode: "screen" }} />
      <Btn onClick={onEnter} className="mt-8 px-8 py-3 text-base">Entrar</Btn>
    </div>
  );
}

function LoginScreen({ onSuccess }) {
  const [login, setLogin] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState("");
  const [entrando, setEntrando] = useState(false);

  const entrar = async () => {
    const termo = login.trim().toLowerCase();
    const termoDigits = onlyDigits(login);
    const achado = LOGINS.find((l) =>
      l.usuario.toLowerCase() === termo ||
      l.email.toLowerCase() === termo ||
      (l.cpf && termoDigits.length === 11 && onlyDigits(l.cpf) === termoDigits)
    );
    if (!achado) { setErro("Usuário ou senha incorretos."); return; }
    setErro("");
    setEntrando(true);
    try {
      await signInWithEmailAndPassword(auth, achado.email, senha);
      onSuccess(achado.usuario);
    } catch (e) {
      setErro("Usuário ou senha incorretos.");
    } finally {
      setEntrando(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 px-6">
      <div className="w-full max-w-sm rounded-2xl border border-navy-800 bg-navy-900 p-6 shadow-2xl">
        <div className="mb-5 text-center">
          <Landmark size={28} className="mx-auto mb-2 text-gold-300" />
          <h1 className="text-lg font-semibold text-gold-300">Banco Di'Roma</h1>
          <p className="text-xs text-navy-400">Entre com seu usuário, e-mail ou CPF</p>
        </div>
        <div className="space-y-4">
          <Field label="Usuário, e-mail ou CPF">
            <TextInput value={login} onChange={(e) => { setLogin(e.target.value); setErro(""); }}
              onKeyDown={(e) => e.key === "Enter" && entrar()} placeholder="Usuário, e-mail ou CPF" />
          </Field>
          <Field label="Senha">
            <TextInput type="password" value={senha} onChange={(e) => { setSenha(e.target.value); setErro(""); }}
              onKeyDown={(e) => e.key === "Enter" && entrar()} placeholder="Sua senha" />
          </Field>
          {erro && <p className="text-sm text-rose-400">{erro}</p>}
          <Btn onClick={entrar} disabled={entrando} className="w-full justify-center">{entrando ? "Entrando..." : "Entrar"}</Btn>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [stage, setStage] = useState("splash");
  const [usuarioLogado, setUsuarioLogado] = useState("");
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthChecked(true);
      if (user) {
        const achado = LOGINS.find((l) => l.email === user.email);
        setUsuarioLogado(achado?.usuario || user.email);
        setStage("app");
      }
    });
    return unsub;
  }, []);

  if (!authChecked) return <div className="min-h-screen bg-navy-950" />;

  if (stage === "splash") {
    return <SplashScreen onEnter={() => setStage("login")} />;
  }
  if (stage === "login") {
    return <LoginScreen onSuccess={(u) => { setUsuarioLogado(u); setStage("app"); }} />;
  }
  const sair = () => {
    signOut(auth);
    setUsuarioLogado("");
    setStage("splash");
  };

  return <MainApp usuario={usuarioLogado} onLogout={sair} />;
}

function MainApp({ usuario, onLogout }) {
  const [customers, setCustomers] = useState([]);
  const [contracts, setContracts] = useState([]);
  const [installments, setInstallments] = useState([]);
  const [payments, setPayments] = useState([]);
  const [audit, setAudit] = useState([]);
  const [ready, setReady] = useState({ customers: false, contracts: false, installments: false, payments: false, audit: false });
  const [saveStatus, setSaveStatus] = useState("saved");
  const [route, setRoute] = useState({ page: "resumo" });
  const [sidebar, setSidebar] = useState(false);
  const [toast, setToast] = useState(null);
  const [cols, setCols] = useState(DEFAULT_CUSTOMER_COLS);
  const [contractCols, setContractCols] = useState(DEFAULT_CONTRACT_COLS);
  const [perfilOpen, setPerfilOpen] = useState(false);
  const hoje = todayISO();

  useEffect(() => {
    const bloquearScrollNumero = (e) => {
      if (e.target?.tagName === "INPUT" && e.target.type === "number") e.preventDefault();
    };
    document.addEventListener("wheel", bloquearScrollNumero, { passive: false });
    return () => document.removeEventListener("wheel", bloquearScrollNumero);
  }, []);

  useEffect(() => {
    const mapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const escutar = (nomeColecao, setState, chaveReady) =>
      onSnapshot(
        collection(fsdb, nomeColecao),
        (snap) => {
          setState(mapDocs(snap));
          setReady((r) => ({ ...r, [chaveReady]: true }));
          setSaveStatus("saved");
        },
        (e) => {
          console.warn(`Não foi possível sincronizar "${nomeColecao}".`, e);
          setSaveStatus("error");
        },
      );
    const unsubs = [
      escutar("customers", setCustomers, "customers"),
      escutar("contracts", setContracts, "contracts"),
      escutar("installments", setInstallments, "installments"),
      escutar("payments", setPayments, "payments"),
      escutar("audit", setAudit, "audit"),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const db = useMemo(() => ({ customers, contracts, installments, payments, audit }), [customers, contracts, installments, payments, audit]);
  const carregado = Object.values(ready).every(Boolean);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(COLS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Array.isArray(saved.clientes)) setCols(saved.clientes);
      if (Array.isArray(saved.contratos)) setContractCols(saved.contratos);
    } catch (e) {
      console.warn("Não foi possível ler as colunas salvas.", e);
    }
  }, []);

  const salvarColunas = (chave, valores) => {
    try {
      const raw = localStorage.getItem(COLS_KEY);
      const atual = raw ? JSON.parse(raw) : {};
      atual[chave] = valores;
      localStorage.setItem(COLS_KEY, JSON.stringify(atual));
      setToast("Colunas salvas.");
    } catch (e) {
      console.warn("Não foi possível salvar as colunas.", e);
    }
  };

  const [perfil, setPerfil] = useState(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(fsdb, "perfis", usuario), (snap) => setPerfil(snap.exists() ? snap.data() : null),
      (e) => console.warn("Não foi possível ler o perfil.", e));
    return unsub;
  }, [usuario]);

  const salvarPerfil = async (dados) => {
    try {
      await setDoc(doc(fsdb, "perfis", usuario), dados);
      setToast("Perfil salvo.");
    } catch (e) {
      console.warn("Não foi possível salvar o perfil.", e);
    }
  };

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const go = (page, params = {}) => { setRoute({ page, ...params }); setSidebar(false); };
  const index = useContractIndex(db || { contracts: [], installments: [], payments: [] }, hoje);

  /* notificações */
  const notifs = useMemo(() => {
    if (!db) return [];
    const out = [];
    const hojeList = db.installments.filter((i) => !i.canceled && saldoOf(i) > 0 && i.dueDate === hoje);
    const venc = db.installments.filter((i) => !i.canceled && saldoOf(i) > 0 && daysBetween(hoje, i.dueDate) < 0);
    if (hojeList.length) out.push({ id: "n1", t: `${hojeList.length} parcela(s) vencem hoje`, s: BRL(hojeList.reduce((a, i) => a + saldoOf(i), 0)), go: () => go("contratos") });
    if (venc.length) out.push({ id: "n2", t: `${venc.length} parcela(s) em atraso`, s: BRL(venc.reduce((a, i) => a + saldoOf(i), 0)), go: () => go("contratos") });
    const prox = db.installments.filter((i) => !i.canceled && saldoOf(i) > 0 && daysBetween(hoje, i.dueDate) > 0 && daysBetween(hoje, i.dueDate) <= 3);
    if (prox.length) out.push({ id: "n3", t: `${prox.length} parcela(s) vencem em até 3 dias`, s: BRL(prox.reduce((a, i) => a + saldoOf(i), 0)), go: () => go("contratos") });
    const piores = [...new Set(venc.map((i) => db.contracts.find((k) => k.id === i.contractId)?.customerId))].slice(0, 2);
    piores.forEach((cid, idx) => {
      const c = db.customers.find((x) => x.id === cid);
      if (c) out.push({ id: "n4" + idx, t: `${c.name} tem parcelas em atraso`, s: c.phone, go: () => go("clientes") });
    });
    return out;
  }, [db, hoje]);

  if (!carregado) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-navy-950 text-sm text-navy-500">
        Carregando o Banco Di'Roma...
      </div>
    );
  }

  /* mutações — cada uma grava direto no Firestore (writeBatch garante que tudo dentro dela grava junto ou nada grava) */
  const addAudit = (batch, entry) => {
    const ref = doc(collection(fsdb, "audit"));
    batch.set(ref, { user: usuario, at: hoje + "T" + new Date().toTimeString().slice(0, 5), ...entry });
  };

  const proximoNumeroContrato = () => runTransaction(fsdb, async (tx) => {
    const ref = doc(fsdb, "meta", "contadores");
    const snap = await tx.get(ref);
    const atual = snap.exists() && typeof snap.data().contrato === "number" ? snap.data().contrato : 201;
    tx.set(ref, { contrato: atual + 1 }, { merge: true });
    return String(atual);
  });

  const saveCustomer = async (data) => {
    const batch = writeBatch(fsdb);
    if (route.customerId) {
      batch.update(doc(fsdb, "customers", route.customerId), data);
      addAudit(batch, { entityType: "cliente", entityId: route.customerId, action: "Cliente atualizado", detail: data.name });
    } else {
      const ref = doc(collection(fsdb, "customers"));
      batch.set(ref, { ...data, createdBy: usuario, createdAt: hoje });
      addAudit(batch, { entityType: "cliente", entityId: ref.id, action: "Cliente cadastrado", detail: data.name });
    }
    await batch.commit();
    setToast(route.customerId ? "Cliente atualizado." : "Cliente cadastrado.");
    go("clientes");
  };

  const deleteCustomer = async (id) => {
    const contractsSnap = await getDocs(query(collection(fsdb, "contracts"), where("customerId", "==", id)));
    const contractIds = contractsSnap.docs.map((d) => d.id);
    const instSnaps = await Promise.all(contractIds.map((cid) => getDocs(query(collection(fsdb, "installments"), where("contractId", "==", cid)))));
    const paySnaps = await Promise.all(contractIds.map((cid) => getDocs(query(collection(fsdb, "payments"), where("contractId", "==", cid)))));
    const batch = writeBatch(fsdb);
    batch.delete(doc(fsdb, "customers", id));
    contractsSnap.docs.forEach((d) => batch.delete(d.ref));
    instSnaps.forEach((snap) => snap.docs.forEach((d) => batch.delete(d.ref)));
    paySnaps.forEach((snap) => snap.docs.forEach((d) => batch.delete(d.ref)));
    addAudit(batch, { entityType: "cliente", entityId: id, action: "Cliente excluído", detail: `${contractIds.length} contrato(s) removidos junto` });
    await batch.commit();
    setToast("Cliente excluído.");
  };

  const finishContract = async (f, calc) => {
    const number = await proximoNumeroContrato();
    const batch = writeBatch(fsdb);
    const contractRef = doc(collection(fsdb, "contracts"));
    batch.set(contractRef, {
      number, customerId: f.customerId,
      beneficiaryName: f.beneficiaryName?.trim() || db.customers.find((c) => c.id === f.customerId)?.name || "",
      type: f.type, requestedAmount: round2(Number(f.requestedAmount)),
      interestRate: Number(f.interestRate), contractValue: calc.valorContrato,
      installmentCount: calc.n, installmentAmount: calc.parcela,
      issueDate: f.issueDate, firstPaymentDate: f.firstPaymentDate,
      createdBy: usuario, createdAt: hoje + "T" + new Date().toTimeString().slice(0, 5),
    });
    calc.rows.forEach((r) => {
      const instRef = doc(collection(fsdb, "installments"));
      batch.set(instRef, { ...r, contractId: contractRef.id, paidAmount: 0, interestAmount: 0, canceled: false });
    });
    addAudit(batch, {
      entityType: "contrato", entityId: contractRef.id, action: "Contrato criado",
      detail: `${f.type} · ${BRL(Number(f.requestedAmount))} em ${calc.n}x de ${BRL(calc.parcela)}`,
    });
    await batch.commit();
    setToast(`Contrato criado. ${calc.n} parcelas geradas em contas a receber.`);
    go("contratos");
  };

  const finishChequesBatch = async (lista) => {
    const inicio = await runTransaction(fsdb, async (tx) => {
      const ref = doc(fsdb, "meta", "contadores");
      const snap = await tx.get(ref);
      const atual = snap.exists() && typeof snap.data().contrato === "number" ? snap.data().contrato : 201;
      tx.set(ref, { contrato: atual + lista.length }, { merge: true });
      return atual;
    });
    const batch = writeBatch(fsdb);
    lista.forEach((c, idx) => {
      const number = String(inicio + idx);
      const contractRef = doc(collection(fsdb, "contracts"));
      batch.set(contractRef, {
        number, customerId: c.customerId, beneficiaryName: c.issuerName, issuerName: c.issuerName,
        type: "Cheque", requestedAmount: c.amount, interestRate: 0, contractValue: c.amount,
        installmentCount: 1, installmentAmount: c.amount,
        issueDate: hoje, firstPaymentDate: c.dueDate,
        createdBy: usuario, createdAt: hoje + "T" + new Date().toTimeString().slice(0, 5),
      });
      const instRef = doc(collection(fsdb, "installments"));
      batch.set(instRef, { number: 1, dueDate: c.dueDate, originalAmount: c.amount, interestAmount: 0, paidAmount: 0, contractId: contractRef.id, canceled: false });
      addAudit(batch, {
        entityType: "contrato", entityId: contractRef.id, action: "Cheque lançado",
        detail: `${BRL(c.amount)} · emitente ${c.issuerName} · liquidar em ${fmtDate(c.dueDate)}`,
      });
    });
    await batch.commit();
    setToast(lista.length > 1 ? `${lista.length} cheques lançados.` : "Cheque lançado.");
    go("contratos");
  };

  const tornarDuplicata = async (id) => {
    const inst = db.installments.find((i) => i.contractId === id);
    const batch = writeBatch(fsdb);
    batch.update(doc(fsdb, "contracts", id), { type: "Duplicata", issueDate: hoje, firstPaymentDate: inst.dueDate });
    addAudit(batch, {
      entityType: "contrato", entityId: id, action: "Cheque convertido em duplicata",
      detail: `Nova emissão ${fmtDate(hoje)} · vencimento ${fmtDate(inst.dueDate)}`,
    });
    await batch.commit();
    setToast("Cheque transformado em duplicata.");
  };

  const postergarCheque = async ({ installmentId, contractId, customerId, novaData, jurosValor, method }) => {
    const jv = round2(Number(jurosValor) || 0);
    const batch = writeBatch(fsdb);
    if (jv > 0) {
      const ref = doc(collection(fsdb, "payments"));
      batch.set(ref, { installmentId, contractId, customerId, date: hoje, amount: jv, method, kind: "juros", createdBy: usuario });
    }
    batch.update(doc(fsdb, "installments", installmentId), { dueDate: novaData });
    addAudit(batch, {
      entityType: "contrato", entityId: contractId, action: "Cheque postergado",
      detail: `Nova data ${fmtDate(novaData)}${jv > 0 ? ` · juros ${BRL(jv)} via ${method}` : ""}`,
    });
    await batch.commit();
    setToast("Cheque postergado.");
  };

  const deleteContract = async (id) => {
    const instSnap = await getDocs(query(collection(fsdb, "installments"), where("contractId", "==", id)));
    const paySnap = await getDocs(query(collection(fsdb, "payments"), where("contractId", "==", id)));
    const batch = writeBatch(fsdb);
    batch.delete(doc(fsdb, "contracts", id));
    instSnap.docs.forEach((d) => batch.delete(d.ref));
    paySnap.docs.forEach((d) => batch.delete(d.ref));
    addAudit(batch, { entityType: "contrato", entityId: id, action: "Contrato excluído", detail: "Parcelas e pagamentos removidos" });
    await batch.commit();
    setToast("Contrato excluído.");
  };

  const updateContractValue = async (id, novoValor) => {
    const batch = writeBatch(fsdb);
    batch.update(doc(fsdb, "contracts", id), { contractValue: round2(novoValor) });
    addAudit(batch, { entityType: "contrato", entityId: id, action: "Saldo devedor ajustado", detail: `Novo valor do contrato: ${BRL(round2(novoValor))}` });
    await batch.commit();
  };

  const updateDuplicataDueDate = async (contractId, installmentId, novaData) => {
    const batch = writeBatch(fsdb);
    batch.update(doc(fsdb, "installments", installmentId), { dueDate: novaData });
    batch.update(doc(fsdb, "contracts", contractId), { firstPaymentDate: novaData });
    addAudit(batch, { entityType: "contrato", entityId: contractId, action: "Vencimento da duplicata alterado", detail: `Novo vencimento: ${fmtDate(novaData)}` });
    await batch.commit();
    setToast("Vencimento atualizado.");
  };

  const updateBeneficiary = async (id, novoNome) => {
    const batch = writeBatch(fsdb);
    batch.update(doc(fsdb, "contracts", id), { beneficiaryName: novoNome });
    addAudit(batch, { entityType: "contrato", entityId: id, action: "Beneficiário alterado", detail: `Novo beneficiário: ${novoNome}` });
    await batch.commit();
  };

  const registerPayment = async (p) => {
    const inst = db.installments.find((i) => i.id === p.installmentId);
    const contract = db.contracts.find((k) => k.id === p.contractId);
    const parcelaVal = round2(p.parcelaAmount || 0);
    const jurosVal = round2(p.jurosAmount || 0);
    const novoPago = round2(inst.paidAmount + parcelaVal);
    const quitada = novoPago >= round2(inst.originalAmount) - 0.004;
    const renovaDuplicata = quitada && contract?.type === "Duplicata";
    const batch = writeBatch(fsdb);
    const contractUpdate = {};
    if (renovaDuplicata) {
      const novaData = addMonths(inst.dueDate, 1);
      batch.update(doc(fsdb, "installments", p.installmentId), { paidAmount: 0, dueDate: novaData });
      contractUpdate.firstPaymentDate = novaData;
    } else {
      batch.update(doc(fsdb, "installments", p.installmentId), { paidAmount: novoPago });
    }
    if (parcelaVal > 0) {
      const ref = doc(collection(fsdb, "payments"));
      batch.set(ref, { installmentId: p.installmentId, contractId: p.contractId, customerId: p.customerId, date: p.date, amount: parcelaVal, method: p.method, kind: "parcela", createdBy: usuario });
    }
    if (jurosVal > 0) {
      const ref = doc(collection(fsdb, "payments"));
      batch.set(ref, { installmentId: p.installmentId, contractId: p.contractId, customerId: p.customerId, date: p.date, amount: jurosVal, method: p.method, kind: "juros", createdBy: usuario });
      const valorAtual = round2(contract?.contractValue ?? contract?.requestedAmount ?? 0);
      contractUpdate.contractValue = round2(valorAtual + jurosVal);
    }
    if (Object.keys(contractUpdate).length > 0) {
      batch.update(doc(fsdb, "contracts", p.contractId), contractUpdate);
    }
    addAudit(batch, {
      entityType: "contrato", entityId: p.contractId,
      action: `Pagamento da parcela ${String(inst.number).padStart(2, "0")}`,
      detail: `${BRL(parcelaVal)} de parcela + ${BRL(jurosVal)} de juros via ${p.method} · parcela ${quitada ? (renovaDuplicata ? `quitada e renovada para ${fmtDate(addMonths(inst.dueDate, 1))}` : "quitada") : "parcialmente paga"}`,
    });
    if (!renovaDuplicata) {
      const outrosAbertos = db.installments.filter((i) => i.contractId === p.contractId && i.id !== p.installmentId && saldoOf(i) > 0).length;
      if (outrosAbertos + (quitada ? 0 : 1) === 0) {
        addAudit(batch, { entityType: "contrato", entityId: p.contractId, action: "Contrato quitado", detail: "Todas as parcelas foram pagas" });
      }
    }
    await batch.commit();
    setToast(renovaDuplicata ? "Pagamento registrado. Duplicata renovada para o próximo mês." : "Pagamento registrado.");
  };

  const pagarJuros = async ({ installmentId, contractId, customerId, date, method, valor, postergar }) => {
    const jv = round2(Number(valor) || 0);
    const inst = db.installments.find((i) => i.id === installmentId);
    const contract = db.contracts.find((k) => k.id === contractId);
    const batch = writeBatch(fsdb);
    if (jv > 0) {
      const ref = doc(collection(fsdb, "payments"));
      batch.set(ref, { installmentId, contractId, customerId, date, amount: jv, method, kind: "juros", createdBy: usuario });
      const valorAtual = round2(contract?.contractValue ?? contract?.requestedAmount ?? 0);
      batch.update(doc(fsdb, "contracts", contractId), { contractValue: round2(valorAtual + jv) });
    }
    let novaData = null;
    if (postergar) {
      const list = db.installments.filter((i) => i.contractId === contractId && i.id !== installmentId);
      const last = list.reduce((m, i) => (!m || i.number > m.number ? i : m), null);
      const novoNumero = last ? last.number + 1 : inst.number;
      novaData = addMonths(last ? last.dueDate : inst.dueDate, 1);
      batch.update(doc(fsdb, "installments", installmentId), { dueDate: novaData, number: novoNumero });
    }
    const detailParts = [];
    if (jv > 0) detailParts.push(`${BRL(jv)} de juros via ${method}`);
    if (postergar) detailParts.push(`parcela ${String(inst.number).padStart(2, "0")} postergada para ${fmtDate(novaData)}`);
    addAudit(batch, {
      entityType: "contrato", entityId: contractId,
      action: postergar ? "Parcela postergada" : `Juros pago — parcela ${String(inst.number).padStart(2, "0")}`,
      detail: detailParts.join(" · ") || "Sem alterações",
    });
    await batch.commit();
    setToast(postergar ? "Parcela postergada." : "Juros registrado.");
  };

  const quitarContrato = async (id) => {
    const contract = db.contracts.find((k) => k.id === id);
    const insts = db.installments.filter((i) => i.contractId === id && !i.canceled);
    const pagoAntes = round2(db.payments.filter((p) => p.contractId === id && p.kind !== "juros").reduce((s, p) => s + p.amount, 0));
    const valorContrato = round2(contract.contractValue ?? contract.requestedAmount);
    const restante = round2(Math.max(0, valorContrato - pagoAntes));
    const batch = writeBatch(fsdb);
    if (restante > 0) {
      const alvo = insts.find((i) => saldoOf(i) > 0) || insts[insts.length - 1];
      const ref = doc(collection(fsdb, "payments"));
      batch.set(ref, { installmentId: alvo?.id, contractId: id, customerId: contract.customerId, date: hoje, amount: restante, method: "Quitação", kind: "parcela", createdBy: usuario });
    }
    insts.forEach((i) => batch.update(doc(fsdb, "installments", i.id), { paidAmount: i.originalAmount }));
    addAudit(batch, {
      entityType: "contrato", entityId: id, action: "Contrato quitado manualmente",
      detail: `Saldo de ${BRL(restante)} baixado · todas as parcelas marcadas como pagas`,
    });
    await batch.commit();
    setToast("Contrato quitado.");
  };

  const novoVencimento = async (contractId, novaData) => {
    const novoDia = Number(novaData.split("-")[2]);
    const setDiaDoMes = (iso, dia) => {
      const [y, m] = iso.split("-").map(Number);
      const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate();
      return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(dia, ultimo)).padStart(2, "0")}`;
    };
    const alvo = db.installments.filter((i) => i.contractId === contractId && !i.canceled && saldoOf(i) > 0);
    const batch = writeBatch(fsdb);
    alvo.forEach((i) => batch.update(doc(fsdb, "installments", i.id), { dueDate: setDiaDoMes(i.dueDate, novoDia) }));
    addAudit(batch, { entityType: "contrato", entityId: contractId, action: "Novo vencimento definido", detail: `Dia ${novoDia} para todas as parcelas em aberto` });
    await batch.commit();
    setToast("Vencimento atualizado.");
  };

  const recalcularParcelas = async (contractId, novoValor, novaQtd) => {
    const todas = db.installments.filter((i) => i.contractId === contractId && !i.canceled);
    const pagas = todas.filter((i) => saldoOf(i) <= 0);
    const abertas = todas.filter((i) => saldoOf(i) > 0).sort((a, b) => a.number - b.number);
    const dataInicial = abertas[0]?.dueDate || hoje;
    const numeroInicial = pagas.reduce((m, i) => Math.max(m, i.number), 0) + 1;
    const batch = writeBatch(fsdb);
    abertas.forEach((i) => batch.delete(doc(fsdb, "installments", i.id)));
    for (let k = 0; k < novaQtd; k++) {
      const ref = doc(collection(fsdb, "installments"));
      batch.set(ref, {
        number: numeroInicial + k,
        dueDate: addMonths(dataInicial, k),
        originalAmount: round2(novoValor),
        interestAmount: 0,
        paidAmount: 0,
        contractId,
        canceled: false,
      });
    }
    addAudit(batch, { entityType: "contrato", entityId: contractId, action: "Parcelas recalculadas", detail: `${novaQtd}x de ${BRL(novoValor)} substituindo as parcelas em aberto` });
    await batch.commit();
    setToast("Parcelas recalculadas.");
  };

  const TITLES = {
    resumo: ["Resumo", "Visão geral da sua carteira."],
    clientes: ["Clientes", "Gerencie seus clientes."],
    "cliente-form": [route.customerId ? "Editar cliente" : "Novo cliente", "Preencha os dados do cadastro."],
    contratos: ["Contratos", "Gerencie seus contratos."],
    "contrato-novo": ["Novo contrato", "Quatro etapas: solicitação, simulação, apresentação e fechamento."],
    "cheque-novo": ["Lançar cheque", "Registre um cheque recebido como forma de pagamento."],
    contrato: ["Contrato", "Detalhes, parcelas e histórico."],
  };
  const [title, subtitle] = TITLES[route.page] || ["Banco Di'Roma", ""];
  const contract = route.contractId ? db.contracts.find((k) => k.id === route.contractId) : null;

  return (
    <div className="min-h-screen bg-navy-950 text-navy-100">
      {/* sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-60 border-r border-navy-800 bg-navy-900 p-4 transition-transform lg:translate-x-0 ${sidebar ? "translate-x-0" : "-translate-x-full"}`}>
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Landmark size={20} className="text-gold-300" />
            <div>
              <p className="text-lg font-semibold tracking-tight text-gold-300">Banco Di'Roma</p>
              <p className="text-xs text-navy-500">Gestão de crédito</p>
            </div>
          </div>
          <button onClick={() => setSidebar(false)} className="rounded-lg p-1 text-navy-500 hover:bg-navy-800 lg:hidden"><X size={18} /></button>
        </div>
        <nav className="space-y-1">
          {NAV.map((n) => {
            const active = route.page === n.id || (n.id === "contratos" && ["contrato", "contrato-novo"].includes(route.page)) || (n.id === "clientes" && route.page === "cliente-form");
            return (
              <button key={n.id} onClick={() => go(n.id)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${active ? "bg-navy-800 text-navy-50" : "text-navy-400 hover:bg-navy-800 hover:text-navy-200"}`}>
                <n.icon size={17} className={active ? "text-gold-300" : ""} />
                {n.label}
              </button>
            );
          })}
        </nav>
        <div className="absolute inset-x-4 bottom-4 space-y-2">
          <button onClick={() => setPerfilOpen(true)}
            className="flex w-full items-center gap-3 rounded-xl border border-navy-800 px-3 py-2 text-left hover:bg-navy-800">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gold-300 text-lg font-semibold text-navy-950">
              {perfil?.foto ? <img src={perfil.foto} alt="" className="h-full w-full object-cover" /> : usuario.slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm text-navy-200">{perfil?.nomeUsuario || usuario}</p>
              <p className="text-xs text-navy-500">Administrador</p>
            </div>
          </button>
        </div>
      </aside>
      {sidebar && <div className="fixed inset-0 z-30 bg-black bg-opacity-60 lg:hidden" onClick={() => setSidebar(false)} />}

      {/* conteúdo */}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-navy-800 bg-navy-950 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <button onClick={() => setSidebar(true)} className="rounded-lg p-2 text-navy-400 hover:bg-navy-800 lg:hidden"><Menu size={18} /></button>
            <div className="flex-1" />
            <div className="flex items-center gap-1.5 text-xs text-navy-500">
              <span className={`h-1.5 w-1.5 rounded-full ${saveStatus === "saving" ? "animate-pulse bg-gold-400" : saveStatus === "error" ? "bg-rose-400" : "bg-gold-600"}`} />
              {saveStatus === "saving" ? "Salvando..." : saveStatus === "error" ? "Erro ao salvar" : "Salvo"}
            </div>
            <Dropdown
              button={(t) => (
                <button onClick={t} className="relative rounded-lg p-2 text-navy-400 hover:bg-navy-800 hover:text-navy-200">
                  <Bell size={18} />
                  {notifs.length > 0 && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-gold-400" />}
                </button>
              )}
            >
              {(close) => (
                <div className="w-80 max-w-full">
                  <p className="px-3 py-2 text-xs uppercase text-navy-500">Notificações</p>
                  {notifs.length === 0 ? (
                    <p className="px-3 pb-3 text-sm text-navy-500">Tudo em dia por aqui.</p>
                  ) : notifs.map((n) => (
                    <button key={n.id} onClick={() => { n.go(); close(); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-navy-800">
                      <p className="text-sm text-navy-200">{n.t}</p>
                      <p className="text-xs tabular-nums text-navy-500">{n.s}</p>
                    </button>
                  ))}
                </div>
              )}
            </Dropdown>
          </div>
        </header>

        <main className="px-4 py-5 sm:px-6">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              {["contrato", "contrato-novo", "cheque-novo", "cliente-form"].includes(route.page) && (
                <button onClick={() => go(route.page === "cliente-form" ? "clientes" : "contratos")}
                  className="mb-1 inline-flex items-center gap-1 text-xs text-navy-500 hover:text-navy-300">
                  <ArrowLeft size={13} /> Voltar
                </button>
              )}
              <h1 className="text-2xl font-semibold tracking-tight text-navy-50">
                {route.page === "contrato" && contract
                  ? `Contrato do Cliente ${db.customers.find((c) => c.id === contract.customerId)?.code ?? contract.number}`
                  : title}
              </h1>
              <p className="mt-0.5 text-sm text-navy-400">{subtitle}</p>
            </div>
            {route.page === "clientes" && <Btn onClick={() => go("cliente-form", {})}><Plus size={15} /> Novo cliente</Btn>}
            {route.page === "contratos" && (
              <div className="flex gap-2">
                <Btn variant="outline" onClick={() => go("cheque-novo", {})}><Landmark size={15} /> Lançar Cheque</Btn>
                <Btn onClick={() => go("contrato-novo", {})}><Plus size={15} /> Novo contrato</Btn>
              </div>
            )}
          </div>

          {route.page === "resumo" && <Dashboard db={db} hoje={hoje} go={go} />}
          {route.page === "clientes" && (
            <CustomersPage db={db} go={go} onDelete={deleteCustomer} cols={cols} setCols={setCols} onSaveCols={() => salvarColunas("clientes", cols)} />
          )}
          {route.page === "cliente-form" && (
            <CustomerForm
              key={route.customerId || "novo"}
              initial={route.customerId ? db.customers.find((c) => c.id === route.customerId) : null}
              existing={db.customers}
              onSave={saveCustomer}
              onCancel={() => go("clientes")}
            />
          )}
          {route.page === "contratos" && <ContractsPage db={db} hoje={hoje} index={index} go={go} preset={route.preset} cols={contractCols} setCols={setContractCols} onSaveCols={() => salvarColunas("contratos", contractCols)} onQuitar={quitarContrato} />}
          {route.page === "contrato-novo" && (
            <ContractWizard db={db} presetCustomer={route.customerId} onFinish={finishContract} onCancel={() => go("contratos")} />
          )}
          {route.page === "cheque-novo" && (
            <ChequeForm db={db} onFinish={finishChequesBatch} onCancel={() => go("contratos")} />
          )}
          {route.page === "contrato" && contract && contract.type === "Cheque" && (
            <ChequeDetail key={contract.id} db={db} hoje={hoje} contract={contract} index={index} go={go}
              onTornarDuplicata={tornarDuplicata} onPostergarCheque={postergarCheque} onDelete={deleteContract} onQuitar={quitarContrato} />
          )}
          {route.page === "contrato" && contract && contract.type !== "Cheque" && (
            <ContractDetail key={contract.id} db={db} hoje={hoje} contract={contract} index={index} go={go} onPay={registerPayment} onDelete={deleteContract} onUpdateValue={updateContractValue} onUpdateBeneficiary={updateBeneficiary} onPagarJuros={pagarJuros} onPostergarLivre={postergarCheque} onNovoVencimento={novoVencimento} onRecalcularParcelas={recalcularParcelas} onUpdateDuplicataDueDate={updateDuplicataDueDate} />
          )}
          {route.page === "contrato" && !contract && (
            <EmptyState title="Contrato não encontrado" hint="Ele pode ter sido excluído." action={<Btn onClick={() => go("contratos")}>Ver contratos</Btn>} />
          )}
        </main>
      </div>

      {toast && (
        <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-navy-700 bg-navy-900 px-4 py-2.5 text-sm text-navy-100 shadow-2xl">
          <CheckCircle2 size={16} className="text-gold-400" /> {toast}
        </div>
      )}

      {perfilOpen && (
        <PerfilModal usuario={usuario} perfil={perfil} onSave={salvarPerfil} onClose={() => setPerfilOpen(false)} onLogout={onLogout} />
      )}

    </div>
  );
}

function PerfilModal({ usuario, perfil, onSave, onClose, onLogout }) {
  const [f, setF] = useState(perfil || { nomeUsuario: "", nome: "", cpf: "", nascimento: "", telefone: "", foto: "" });
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const onFoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set("foto", reader.result);
    reader.readAsDataURL(file);
  };

  return (
    <Modal title="Meu perfil" subtitle={usuario} onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-navy-800 text-xl font-semibold text-gold-300">
            {f.foto ? <img src={f.foto} alt="Foto de perfil" className="h-full w-full object-cover" /> : usuario.slice(0, 1).toUpperCase()}
          </div>
          <label className="cursor-pointer rounded-full border border-navy-700 px-3 py-1.5 text-sm text-gold-400 hover:bg-navy-800 hover:text-gold-300">
            Escolher foto
            <input type="file" accept="image/*" className="hidden" onChange={onFoto} />
          </label>
        </div>
        <Field label="Nome de usuário" hint="Aparece no canto inferior esquerdo do menu, no lugar do seu login">
          <TextInput value={f.nomeUsuario} onChange={(e) => set("nomeUsuario", e.target.value)} placeholder={usuario} />
        </Field>
        <Field label="Nome completo">
          <TextInput value={f.nome} onChange={(e) => set("nome", e.target.value)} placeholder="Nome completo" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CPF">
            <TextInput value={f.cpf} onChange={(e) => set("cpf", maskCpfCnpj(e.target.value))} placeholder="000.000.000-00" inputMode="numeric" />
          </Field>
          <Field label="Data de nascimento">
            <DatePicker value={f.nascimento} onChange={(v) => set("nascimento", v)} />
          </Field>
        </div>
        <Field label="Telefone">
          <TextInput value={f.telefone} onChange={(e) => set("telefone", maskPhone(e.target.value))} placeholder="(44) 99999-9999" inputMode="numeric" />
        </Field>
        <div className="flex items-center justify-between gap-2 border-t border-navy-800 pt-4">
          <Btn variant="ghost" onClick={onLogout}><LogOut size={14} /> Sair</Btn>
          <div className="flex gap-2">
            <Btn variant="outline" onClick={onClose}>Cancelar</Btn>
            <Btn onClick={() => { onSave(f); onClose(); }}>Salvar</Btn>
          </div>
        </div>
      </div>
    </Modal>
  );
}

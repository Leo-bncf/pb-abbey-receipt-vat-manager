// Supabase-backed compatibility layer that mimics the base44 SDK surface the
// app uses (entities.X.list/create/update/delete/get/bulkCreate, auth,
// integrations.Core.UploadFile). Lets the pages keep working after migrating
// off base44. AI extraction stays on the Cloudflare Mistral Worker (Upload.jsx).
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

const STORAGE_BUCKET = 'receipts';

const parseOrder = (order) => {
  if (!order) return null;
  const desc = order.startsWith('-');
  return { column: desc ? order.slice(1) : order, ascending: !desc };
};

// Postgres date/timestamp columns reject empty strings — null them out.
const sanitize = (values) => {
  const out = { ...values };
  for (const k of Object.keys(out)) {
    if (k.endsWith('_date') && out[k] === '') out[k] = null;
  }
  return out;
};

function table(name) {
  return {
    async list(order = '-created_date', limit = 1000) {
      let q = supabase.from(name).select('*');
      const o = parseOrder(order);
      if (o) q = q.order(o.column, { ascending: o.ascending });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    async filter(query = {}, order = '-created_date', limit = 1000) {
      let q = supabase.from(name).select('*');
      for (const [k, v] of Object.entries(query)) q = q.eq(k, v);
      const o = parseOrder(order);
      if (o) q = q.order(o.column, { ascending: o.ascending });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) throw error;
      return data || [];
    },
    async get(id) {
      const { data, error } = await supabase.from(name).select('*').eq('id', id).single();
      if (error) throw error;
      return data;
    },
    async create(values) {
      const { data, error } = await supabase.from(name).insert(sanitize(values)).select().single();
      if (error) throw error;
      return data;
    },
    async bulkCreate(arr) {
      const { data, error } = await supabase.from(name).insert(arr.map(sanitize)).select();
      if (error) throw error;
      return data;
    },
    async update(id, values) {
      const { data, error } = await supabase.from(name).update(sanitize(values)).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    async delete(id) {
      const { error } = await supabase.from(name).delete().eq('id', id);
      if (error) throw error;
      return { success: true };
    },
  };
}

async function me() {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    const e = new Error('Not authenticated');
    e.status = 401;
    throw e;
  }
  return {
    id: user.id,
    email: user.email,
    full_name: user.user_metadata?.full_name || user.email,
    role: user.user_metadata?.role || 'admin',
  };
}
async function logout() { await supabase.auth.signOut(); }
async function isAuthenticated() {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
}
// Login is handled by an in-app form (AuthContext); nothing to redirect to.
function redirectToLogin() { window.location.reload(); }

async function UploadFile({ file }) {
  const ext = (file.name?.split('.').pop() || 'bin').toLowerCase();
  const path = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    contentType: file.type || undefined,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { file_url: data.publicUrl };
}

const notImpl = (n) => async () => { throw new Error(`${n} is not available on the self-hosted build`); };

export const base44 = {
  entities: {
    Receipt: table('receipts'),
    Folder: table('folders'),
    ReceiptCorrection: table('receipt_corrections'),
    AIFeedback: table('ai_feedback'),
    VATRate: table('vat_rates'),
    // Tenant (property management)
    Tenant: table('tenants'),
    Unit: table('units'),
    RentPayment: table('rent_payments'),
    Expense: table('expenses'),
    VATQuarter: table('vat_quarters'),
    Alert: table('alerts'),
    AuditLog: table('audit_logs'),
  },
  auth: { me, logout, isAuthenticated, redirectToLogin },
  // No-op activity logging (base44 feature not needed self-hosted)
  appLogs: { logUserInApp: async () => {} },
  integrations: {
    Core: {
      UploadFile,
      InvokeLLM: notImpl('InvokeLLM'),
      ExtractDataFromUploadedFile: notImpl('ExtractDataFromUploadedFile'),
      SendEmail: notImpl('SendEmail'),
      SendSMS: notImpl('SendSMS'),
      GenerateImage: notImpl('GenerateImage'),
    },
  },
};

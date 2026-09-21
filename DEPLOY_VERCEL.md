# Deploying Delphi — browser only, no terminal

Everything here happens in a web browser. Nothing to install.

---

## 1. Vercel account

[vercel.com/signup](https://vercel.com/signup) → **Continue with GitHub** → authorise.

## 2. Import the project

Dashboard → **Add New…** → **Project** → find **`delphi-mvp`** → **Import**.

## 3. Environment variables

Add these six on the import screen, **before** clicking Deploy.

| Name | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Settings → API → Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Settings → API → **anon public** |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** |
| `GOOGLE_GENERATIVE_AI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `PERPLEXITY_API_KEY` | perplexity.ai → Settings → API |
| `FRED_API_KEY` | fred.stlouisfed.org → My Account → API Keys |

The `service_role` key bypasses all row-level security. Treat it like a root
password: Vercel only, never in a commit, never pasted into a chat.

## 4. Deploy

Click **Deploy**. Takes about two minutes.

## 5. Point Vercel at the right branch

**This is the step that catches people out.** Delphi lives on a feature branch,
not `main`, so the first deploy shows the old app with none of it.

**Settings → Git → Production Branch** → set to:

```
claude/delphi-ai-ceo-dashboard-2f8vzf
```

Save, then **Deployments → ⋯ on the newest one → Redeploy**.

*(Once the branch is merged to `main`, this step goes away.)*

## 6. Open it

Vercel gives you a URL like `delphi-mvp.vercel.app`.

1. **Sign Up** — the first account becomes the CHO
2. Go to **`/dashboard/delphi`**

The workspace, the agent roster and the channel connections all create
themselves on first use. Works on phone and tablet too.

---

## First run

1. **New department**
2. Click one of the three examples to fill the form
3. **Create & ask Delphi to staff it** — about 20 seconds
4. Review the proposed team, the reasoning, and the estimated cost
5. **Approve & launch**

Nothing spends money before step 5.

## When something breaks

**Deployments → the deployment → Runtime Logs.** The red text is the real
error. Most first-run failures are a missing or mistyped environment variable.

A build that succeeds but shows the old dashboard means step 5 was skipped.

## What it costs

| | |
|---|---|
| Staffing a department | ~$0.004 |
| A full run with live web searches | ~$0.05–0.20 |

Every department carries a budget cap that halts the pipeline when reached.
The built-in examples default to $5.

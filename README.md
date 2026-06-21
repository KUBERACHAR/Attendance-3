# Attendance Management System

A React + Supabase admin dashboard for managing faculty, subjects, students, attendance records, and attendance reports.

## Features

- Admin dashboard with summary metrics
- Admin login with Supabase Auth email/password
- Faculty login with admin-created Faculty Login ID
- Public readonly student attendance reports without login
- Department, semester, and section class setup
- Bulk student enrollment into a selected class
- Faculty class attendance marking with Present/Absent checkboxes
- Faculty management
- Subject management with department, semester, and faculty assignment
- Attendance report with present, late, absent, total classes, and percentage
- Low-attendance watchlist for students below 75%
- Supabase SQL schema included

## Directory Structure

```text
.
+-- .env.example
+-- README.md
+-- SUPABASE_SETUP_GUIDE.txt
+-- index.html
+-- package.json
+-- supabase
|   +-- schema.sql
+-- src
    +-- App.jsx
    +-- main.jsx
    +-- styles.css
    +-- lib
        +-- supabase.js
```

## Setup

1. Create a Supabase project.
2. Run the SQL from `supabase/schema.sql` in the Supabase SQL Editor.
3. Create an admin user in Supabase Authentication.
4. Insert that admin email into `public.admin_users`.
5. Copy `.env.example` to `.env`.
6. Add your Supabase project URL and anon key:

```env
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

5. Install dependencies:

```bash
npm install
```

On Windows PowerShell, use `npm.cmd install` if script execution is blocked.

## Run Locally

```bash
npm run dev
```

On Windows PowerShell:

```bash
npm.cmd run dev
```

Open the Vite local URL shown in the terminal, usually `http://localhost:5173`.

## Build

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Supabase Notes

The SQL schema includes Row Level Security policies:

- Admin users can manage faculty, subjects, students, attendance, and reports.
- Faculty users can manage attendance for their assigned subjects by department, semester, and section.
- Students do not log in and can only view the public readonly report view.

Read `SUPABASE_SETUP_GUIDE.txt` for the complete Supabase and environment setup walkthrough.

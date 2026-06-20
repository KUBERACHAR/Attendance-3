import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  GraduationCap,
  Loader2,
  LogOut,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { hasSupabaseConfig, supabase } from './lib/supabase';

const emptyFaculty = { faculty_login_id: '', name: '', email: '', phone: '', department: '' };
const emptySubject = { name: '', code: '', semester: '', faculty_id: '' };
const emptyStudent = { roll_no: '', name: '', email: '', phone: '', department: '', semester: '' };
const emptyAttendance = { student_id: '', subject_id: '', attendance_date: new Date().toISOString().slice(0, 10), status: 'present', notes: '' };

function App() {
  const [activeTab, setActiveTab] = useState('reports');
  const [session, setSession] = useState(null);
  const [userRole, setUserRole] = useState({ role: 'student', faculty_id: null, name: 'Student' });
  const [faculties, setFaculties] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [report, setReport] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');

  const isAdmin = userRole.role === 'admin';
  const isFaculty = userRole.role === 'faculty';
  const canManage = isAdmin || isFaculty;

  const resolveRole = useCallback(async (currentSession) => {
    if (!currentSession || !hasSupabaseConfig) {
      setUserRole({ role: 'student', faculty_id: null, name: 'Student' });
      return;
    }

    const { data, error } = await supabase.rpc('get_current_role');
    if (error || !data?.[0] || data[0].role === 'student') {
      await supabase.auth.signOut();
      setSession(null);
      setUserRole({ role: 'student', faculty_id: null, name: 'Student' });
      setMessage(error?.message ?? 'This email is not registered as an admin or active faculty member.');
      return;
    }

    setUserRole(data[0]);
    setActiveTab(data[0].role === 'admin' ? 'dashboard' : 'attendance');
  }, []);

  const loadData = useCallback(async () => {
    if (!hasSupabaseConfig) return;
    setLoading(true);
    setMessage('');

    const reportQuery = supabase.from('attendance_report').select('*').order('student_name', { ascending: true });
    const reportRes = await reportQuery;

    if (reportRes.error) {
      setMessage(reportRes.error.message);
      setLoading(false);
      return;
    }

    const visibleReport = isFaculty
      ? (reportRes.data ?? []).filter((row) => row.faculty_id === userRole.faculty_id)
      : reportRes.data ?? [];

    setReport(visibleReport);

    if (canManage) {
      const [facultyRes, subjectRes, studentRes, attendanceRes] = await Promise.all([
        isAdmin
          ? supabase.from('faculties').select('*').order('created_at', { ascending: false })
          : supabase.from('faculties').select('*').eq('id', userRole.faculty_id),
        supabase.from('subjects').select('*, faculties(name)').order('created_at', { ascending: false }),
        supabase.from('students').select('*').order('created_at', { ascending: false }),
        supabase.from('attendance_records').select('*, students(name, roll_no), subjects(name, code)').order('attendance_date', { ascending: false }),
      ]);

      const firstError = [facultyRes, subjectRes, studentRes, attendanceRes].find((res) => res.error)?.error;
      if (firstError) {
        setMessage(firstError.message);
      } else {
        setFaculties(facultyRes.data ?? []);
        setSubjects(subjectRes.data ?? []);
        setStudents(studentRes.data ?? []);
        setAttendance(attendanceRes.data ?? []);
      }
    } else {
      setFaculties([]);
      setSubjects([]);
      setStudents([]);
      setAttendance([]);
    }

    setLoading(false);
  }, [canManage, isAdmin, isFaculty, userRole.faculty_id]);

  useEffect(() => {
    if (!hasSupabaseConfig) return undefined;

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      resolveRole(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, currentSession) => {
      setSession(currentSession);
      resolveRole(currentSession);
    });

    return () => listener.subscription.unsubscribe();
  }, [resolveRole]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const stats = useMemo(() => {
    const presentLike = attendance.filter((row) => row.status === 'present' || row.status === 'late').length;
    const attendanceRate = attendance.length ? Math.round((presentLike / attendance.length) * 100) : 0;

    return [
      { label: 'Faculty', value: faculties.length, icon: Users },
      { label: 'Subjects', value: subjects.length, icon: BookOpen },
      { label: 'Students', value: students.length, icon: GraduationCap },
      { label: 'Attendance Rate', value: `${attendanceRate}%`, icon: CalendarCheck },
    ];
  }, [attendance, faculties, students, subjects]);

  const filteredReport = report.filter((row) => {
    const haystack = `${row.student_name} ${row.roll_no} ${row.subject_name} ${row.subject_code} ${row.department} ${row.semester} ${row.faculty_name}`.toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUserRole({ role: 'student', faculty_id: null, name: 'Student' });
    setActiveTab('reports');
  };

  const navItems = [
    isAdmin && ['dashboard', BarChart3, 'Dashboard'],
    isAdmin && ['faculties', Users, 'Faculty'],
    isAdmin && ['subjects', BookOpen, 'Subjects'],
    isAdmin && ['students', GraduationCap, 'Students'],
    canManage && ['attendance', CalendarCheck, 'Attendance'],
    ['reports', BarChart3, 'Reports'],
  ].filter(Boolean);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <CalendarCheck size={28} />
          <div>
            <strong>AttendEase</strong>
            <span>{roleLabel(userRole)}</span>
          </div>
        </div>

        <nav className="nav-list" aria-label="Attendance sections">
          {navItems.map(([id, Icon, label]) => (
            <NavButton key={id} id={id} activeTab={activeTab} setActiveTab={setActiveTab} icon={Icon} label={label} />
          ))}
        </nav>

        <AuthPanel session={session} role={userRole} onSignedIn={resolveRole} onSignOut={signOut} />
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p>Attendance Management System</p>
            <h1>{titleFor(activeTab)}</h1>
          </div>
          <button className="icon-button" type="button" onClick={loadData} disabled={loading} title="Refresh data">
            {loading ? <Loader2 className="spin" size={18} /> : <RefreshCw size={18} />}
          </button>
        </header>

        {!hasSupabaseConfig && (
          <div className="notice">
            Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to a local `.env` file, then restart the dev server.
          </div>
        )}

        {message && <div className="notice error">{message}</div>}

        {activeTab === 'dashboard' && isAdmin && <Dashboard stats={stats} report={report} attendance={attendance} />}
        {activeTab === 'faculties' && isAdmin && <FacultySection data={faculties} reload={loadData} />}
        {activeTab === 'subjects' && isAdmin && <SubjectSection data={subjects} faculties={faculties} reload={loadData} />}
        {activeTab === 'students' && isAdmin && <StudentSection data={students} reload={loadData} />}
        {activeTab === 'attendance' && canManage && <AttendanceSection data={attendance} students={students} subjects={subjects} reload={loadData} />}
        {activeTab === 'reports' && <ReportsSection data={filteredReport} query={query} setQuery={setQuery} readonly={!canManage} />}
      </section>
    </main>
  );
}

function AuthPanel({ session, role, onSignedIn, onSignOut }) {
  const [mode, setMode] = useState('admin');
  const [email, setEmail] = useState('');
  const [facultyLoginId, setFacultyLoginId] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const signIn = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');

    let loginEmail = email;
    if (mode === 'faculty') {
      const { data, error: lookupError } = await supabase.rpc('get_faculty_login', { login_id: facultyLoginId });
      if (lookupError || !data?.[0]?.is_active) {
        setError(lookupError?.message ?? 'Faculty ID is not active or does not exist.');
        setBusy(false);
        return;
      }
      loginEmail = data[0].email;
    }

    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });

    if (authError) {
      setError(authError.message);
    } else {
      await onSignedIn(authData.session);
      setEmail('');
      setFacultyLoginId('');
      setPassword('');
    }

    setBusy(false);
  };

  if (session) {
    return (
      <div className="auth-panel">
        <span>Signed in as</span>
        <strong>{role.name || session.user.email}</strong>
        <small>{session.user.email}</small>
        <button className="secondary-button" type="button" onClick={onSignOut}>
          <LogOut size={16} />
          <span>Sign out</span>
        </button>
      </div>
    );
  }

  return (
    <form className="auth-panel" onSubmit={signIn}>
      <div className="segment">
        <button type="button" className={mode === 'admin' ? 'selected' : ''} onClick={() => setMode('admin')}>Admin</button>
        <button type="button" className={mode === 'faculty' ? 'selected' : ''} onClick={() => setMode('faculty')}>Faculty</button>
      </div>
      {mode === 'admin' ? (
        <label>
          <span>Admin Email</span>
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
      ) : (
        <label>
          <span>Faculty Login ID</span>
          <input value={facultyLoginId} onChange={(event) => setFacultyLoginId(event.target.value)} required />
        </label>
      )}
      <label>
        <span>Password</span>
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
      </label>
      {error && <small className="auth-error">{error}</small>}
      <button className="primary-button" type="submit" disabled={busy || !hasSupabaseConfig}>
        {busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
        <span>Sign in</span>
      </button>
      <small>Students can use reports without signing in.</small>
    </form>
  );
}

function NavButton({ id, activeTab, setActiveTab, icon: Icon, label }) {
  return (
    <button className={activeTab === id ? 'nav-button active' : 'nav-button'} type="button" onClick={() => setActiveTab(id)}>
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );
}

function Dashboard({ stats, report, attendance }) {
  const lowAttendance = report.filter((row) => Number(row.attendance_percentage) < 75 && Number(row.total_classes) > 0).slice(0, 6);
  const recent = attendance.slice(0, 6);

  return (
    <div className="stack">
      <div className="stats-grid">
        {stats.map(({ label, value, icon: Icon }) => (
          <div className="stat-card" key={label}>
            <Icon size={22} />
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="two-column">
        <Panel title="Low Attendance Watchlist">
          <SimpleTable
            columns={['Student', 'Subject', 'Attendance']}
            rows={lowAttendance.map((row) => [row.student_name, row.subject_code, `${row.attendance_percentage}%`])}
            empty="No students below 75% yet."
          />
        </Panel>
        <Panel title="Recent Attendance">
          <SimpleTable
            columns={['Date', 'Student', 'Status']}
            rows={recent.map((row) => [row.attendance_date, row.students?.name ?? '-', row.status])}
            empty="No attendance records yet."
          />
        </Panel>
      </div>
    </div>
  );
}

function FacultySection({ data, reload }) {
  return (
    <CrudSection
      title="Faculty"
      table="faculties"
      emptyForm={emptyFaculty}
      reload={reload}
      fields={[
        { key: 'faculty_login_id', label: 'Faculty Login ID', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'email', label: 'Email', type: 'email', required: true },
        { key: 'phone', label: 'Phone' },
        { key: 'department', label: 'Department', required: true },
      ]}
      columns={[
        ['Login ID', (row) => row.faculty_login_id],
        ['Name', (row) => row.name],
        ['Email', (row) => row.email],
        ['Department', (row) => row.department],
        ['Phone', (row) => row.phone || '-'],
      ]}
      data={data}
    />
  );
}

function SubjectSection({ data, faculties, reload }) {
  return (
    <CrudSection
      title="Subjects"
      table="subjects"
      emptyForm={emptySubject}
      reload={reload}
      fields={[
        { key: 'name', label: 'Subject Name', required: true },
        { key: 'code', label: 'Code', required: true },
        { key: 'semester', label: 'Semester', required: true },
        { key: 'faculty_id', label: 'Faculty', type: 'select', options: faculties.map((f) => ({ value: f.id, label: f.name })) },
      ]}
      columns={[
        ['Subject', (row) => row.name],
        ['Code', (row) => row.code],
        ['Semester', (row) => row.semester],
        ['Faculty', (row) => row.faculties?.name ?? '-'],
      ]}
      data={data}
    />
  );
}

function StudentSection({ data, reload }) {
  return (
    <CrudSection
      title="Students"
      table="students"
      emptyForm={emptyStudent}
      reload={reload}
      fields={[
        { key: 'roll_no', label: 'Roll No', required: true },
        { key: 'name', label: 'Name', required: true },
        { key: 'email', label: 'Email', type: 'email' },
        { key: 'phone', label: 'Phone' },
        { key: 'department', label: 'Department', required: true },
        { key: 'semester', label: 'Semester', required: true },
      ]}
      columns={[
        ['Roll No', (row) => row.roll_no],
        ['Name', (row) => row.name],
        ['Department', (row) => row.department],
        ['Semester', (row) => row.semester],
        ['Email', (row) => row.email || '-'],
      ]}
      data={data}
    />
  );
}

function AttendanceSection({ data, students, subjects, reload }) {
  return (
    <CrudSection
      title="Attendance Records"
      table="attendance_records"
      emptyForm={emptyAttendance}
      reload={reload}
      fields={[
        { key: 'student_id', label: 'Student', type: 'select', required: true, options: students.map((s) => ({ value: s.id, label: `${s.roll_no} - ${s.name}` })) },
        { key: 'subject_id', label: 'Subject', type: 'select', required: true, options: subjects.map((s) => ({ value: s.id, label: `${s.code} - ${s.name}` })) },
        { key: 'attendance_date', label: 'Date', type: 'date', required: true },
        { key: 'status', label: 'Status', type: 'select', required: true, options: ['present', 'absent', 'late'].map((status) => ({ value: status, label: status })) },
        { key: 'notes', label: 'Notes' },
      ]}
      columns={[
        ['Date', (row) => row.attendance_date],
        ['Student', (row) => row.students ? `${row.students.roll_no} - ${row.students.name}` : '-'],
        ['Subject', (row) => row.subjects ? `${row.subjects.code} - ${row.subjects.name}` : '-'],
        ['Status', (row) => <StatusPill status={row.status} />],
        ['Notes', (row) => row.notes || '-'],
      ]}
      data={data}
    />
  );
}

function CrudSection({ title, table, emptyForm, fields, columns, data, reload }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    const payload = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value === '' ? null : value]));
    const { error } = await supabase.from(table).insert(payload);
    if (error) alert(error.message);
    else {
      setForm(emptyForm);
      await reload();
    }
    setSaving(false);
  };

  const remove = async (id) => {
    const { error } = await supabase.from(table).delete().eq('id', id);
    if (error) alert(error.message);
    else await reload();
  };

  return (
    <div className="management-grid">
      <Panel title={`Add ${title}`}>
        <form className="form-grid" onSubmit={submit}>
          {fields.map((field) => (
            <label key={field.key}>
              <span>{field.label}</span>
              {field.type === 'select' ? (
                <select required={field.required} value={form[field.key] ?? ''} onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}>
                  <option value="">Select {field.label}</option>
                  {field.options.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  required={field.required}
                  type={field.type ?? 'text'}
                  value={form[field.key] ?? ''}
                  onChange={(event) => setForm({ ...form, [field.key]: event.target.value })}
                />
              )}
            </label>
          ))}
          <button className="primary-button" type="submit" disabled={saving || !hasSupabaseConfig}>
            {saving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
            <span>Save</span>
          </button>
        </form>
      </Panel>

      <Panel title={`${title} List`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {columns.map(([heading]) => <th key={heading}>{heading}</th>)}
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.id}>
                  {columns.map(([heading, render]) => <td key={heading}>{render(row)}</td>)}
                  <td>
                    <button className="danger-button" type="button" onClick={() => remove(row.id)} title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!data.length && (
                <tr>
                  <td colSpan={columns.length + 1} className="empty-cell">No records found.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function ReportsSection({ data, query, setQuery, readonly }) {
  return (
    <Panel title={readonly ? 'Public Attendance Reports' : 'Attendance Reports'}>
      <div className="search-row">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search student, roll no, subject, faculty, department..." />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Roll No</th>
              <th>Student</th>
              <th>Subject</th>
              <th>Faculty</th>
              <th>Total</th>
              <th>Present</th>
              <th>Late</th>
              <th>Absent</th>
              <th>%</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr key={`${row.student_id}-${row.subject_id}`}>
                <td>{row.roll_no}</td>
                <td>{row.student_name}</td>
                <td>{row.subject_code} - {row.subject_name}</td>
                <td>{row.faculty_name || '-'}</td>
                <td>{row.total_classes}</td>
                <td>{row.present_count}</td>
                <td>{row.late_count}</td>
                <td>{row.absent_count}</td>
                <td><strong>{row.attendance_percentage}%</strong></td>
              </tr>
            ))}
            {!data.length && (
              <tr>
                <td colSpan="9" className="empty-cell">No report data found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function Panel({ title, children }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        <Plus size={18} aria-hidden="true" />
      </div>
      {children}
    </section>
  );
}

function SimpleTable({ columns, rows, empty }) {
  return (
    <div className="table-wrap compact">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.join('-')}-${index}`}>
              {row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length} className="empty-cell">{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ status }) {
  return <span className={`status-pill ${status}`}>{status}</span>;
}

function roleLabel(role) {
  if (role.role === 'admin') return 'Admin Console';
  if (role.role === 'faculty') return 'Faculty Console';
  return 'Student Reports';
}

function titleFor(tab) {
  const titles = {
    dashboard: 'Dashboard',
    faculties: 'Manage Faculty',
    subjects: 'Manage Subjects',
    students: 'Manage Students',
    attendance: 'Attendance Records',
    reports: 'Reports',
  };
  return titles[tab] ?? 'Reports';
}

export default App;

import { useCallback, useEffect, useMemo, useState } from 'react';
import { read, utils } from 'xlsx';
import {
  BarChart3,
  BookOpen,
  CalendarCheck,
  FileSpreadsheet,
  GraduationCap,
  Layers,
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

const today = new Date().toISOString().slice(0, 10);
const emptyFaculty = { faculty_login_id: '', name: '', email: '', department: '' };
const emptyGroup = { department: '', semester: '', section: '' };
const emptySubject = { name: '', code: '', class_id: '' };

function App() {
  const [activeTab, setActiveTab] = useState('reports');
  const [session, setSession] = useState(null);
  const [userRole, setUserRole] = useState({ role: 'student', faculty_id: null, name: 'Student' });
  const [academicGroups, setAcademicGroups] = useState([]);
  const [faculties, setFaculties] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [students, setStudents] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [report, setReport] = useState([]);
  const [reportAttendance, setReportAttendance] = useState([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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

    const [reportRes, reportAttendanceRes] = await Promise.all([
      supabase.from('attendance_report').select('*').order('student_name', { ascending: true }),
      supabase.from('attendance_calendar').select('*').order('attendance_date', { ascending: true }),
    ]);
    if (reportRes.error) {
      setMessage(reportRes.error.message);
      setLoading(false);
      return;
    }

    setReport(reportRes.data ?? []);
    setReportAttendance(reportAttendanceRes.data ?? []);

    if (canManage) {
      const [groupRes, facultyRes, subjectRes, studentRes, attendanceRes] = await Promise.all([
        supabase.from('academic_groups').select('*').order('department').order('semester').order('section'),
        isAdmin
          ? supabase.from('faculties').select('*').order('created_at', { ascending: false })
          : supabase.from('faculties').select('*').eq('id', userRole.faculty_id),
        supabase.from('subjects').select('*').order('department').order('semester').order('code'),
        supabase.from('students').select('*').order('roll_no'),
        supabase.from('attendance_records').select('*, students(name, roll_no), subjects(name, code)').order('attendance_date', { ascending: false }),
      ]);

      const firstError = [groupRes, facultyRes, subjectRes, studentRes, attendanceRes].find((res) => res.error)?.error;
      if (firstError) {
        setMessage(firstError.message);
      } else {
        setAcademicGroups(groupRes.data ?? []);
        setFaculties(facultyRes.data ?? []);
        setSubjects(subjectRes.data ?? []);
        setStudents(studentRes.data ?? []);
        setAttendance(attendanceRes.data ?? []);
      }
    } else {
      setAcademicGroups([]);
      setFaculties([]);
      setSubjects([]);
      setStudents([]);
      setAttendance([]);
    }

    setLoading(false);
  }, [canManage, isAdmin, userRole.faculty_id]);

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
      { label: 'Classes', value: academicGroups.length, icon: Layers },
      { label: 'Faculty', value: faculties.length, icon: Users },
      { label: 'Students', value: students.length, icon: GraduationCap },
      // { label: 'Attendance Rate', value: `${attendanceRate}%`, icon: CalendarCheck },
    ];
  }, [academicGroups, attendance, faculties, students]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUserRole({ role: 'student', faculty_id: null, name: 'Student' });
    setActiveTab('reports');
  };

  const navItems = [
    isAdmin && ['dashboard', BarChart3, 'Dashboard'],
    isAdmin && ['groups', Layers, 'Classes'],
    isAdmin && ['faculties', Users, 'Faculty'],
    isAdmin && ['subjects', BookOpen, 'Subjects'],
    isAdmin && ['students', GraduationCap, 'Students'],
    ['reports', BarChart3, 'Reports'],
  ].filter(Boolean);

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <CalendarCheck size={28} />
          <div>
            <strong>Attendance</strong>
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
          <div className="topbar-left">
            <button
              className={mobileMenuOpen ? 'mobile-menu-button active' : 'mobile-menu-button'}
              type="button"
              onClick={() => setMobileMenuOpen((value) => !value)}
              aria-label={mobileMenuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileMenuOpen}
            >
              <span />
            </button>
            <div>
              <p>Attendance Management System</p>
              <h1>{titleFor(activeTab)}</h1>
            </div>
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
        {activeTab === 'groups' && isAdmin && <GroupSection data={academicGroups} reload={loadData} />}
        {activeTab === 'faculties' && isAdmin && <FacultySection data={faculties} reload={loadData} />}
        {activeTab === 'subjects' && isAdmin && <SubjectSection data={subjects} groups={academicGroups} reload={loadData} />}
        {activeTab === 'students' && isAdmin && <StudentSection data={students} groups={academicGroups} reload={loadData} />}
        {activeTab === 'attendance' && canManage && (
          <AttendanceSection data={attendance} students={students} subjects={subjects} groups={academicGroups} reload={loadData} />
        )}
        {activeTab === 'reports' && (
          <ReportsSection data={report} attendance={reportAttendance} query={query} setQuery={setQuery} readonly={!canManage} />
        )}
        {mobileMenuOpen && (
          <div className="mobile-menu-drawer" role="dialog" aria-modal="true">
            <div className="mobile-menu-drawer__content">
              <div className="mobile-menu-drawer__header">
                <strong>Menu</strong>
                <button
                  className="mobile-menu-close"
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  aria-label="Close menu"
                >
                  ×
                </button>
              </div>
              <nav className="nav-list mobile" aria-label="Mobile navigation">
                {navItems.map(([id, Icon, label]) => (
                  <NavButton
                    key={id}
                    id={id}
                    activeTab={activeTab}
                    setActiveTab={(id) => {
                      setActiveTab(id);
                      setMobileMenuOpen(false);
                    }}
                    icon={Icon}
                    label={label}
                  />
                ))}
              </nav>
              <div className="mobile-auth-drawer">
                <AuthPanel session={session} role={userRole} onSignedIn={resolveRole} onSignOut={signOut} />
              </div>
            </div>
          </div>
        )}
        <footer className="app-footer">
          <div className="app-footer__inner">
            <span className="app-footer-line">© 2026 Attendance. All rights reserved.</span>
            <span className="app-footer__dev">Developed by - <a href='https://kuberachar.netlify.app/' target='blank'>Kuberachar</a></span>
          </div>
        </footer>
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
      {/* <div className="two-column">
        <Panel title="Low Attendance Watchlist">
          <SimpleTable
            columns={['Student', 'Class', 'Attendance']}
            rows={lowAttendance.map((row) => [row.student_name, `${row.department} Sem ${row.semester}-${row.section}`, `${row.attendance_percentage}%`])}
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
      </div> */}
    </div>
  );
}

function GroupSection({ data, reload }) {
  return (
    <CrudSection
      title="Class"
      table="academic_groups"
      emptyForm={emptyGroup}
      reload={reload}
      fields={[
        { key: 'department', label: 'Department', required: true },
        { key: 'semester', label: 'Semester', required: true },
        { key: 'section', label: 'Section', required: true },
      ]}
      columns={[
        ['Department', (row) => row.department],
        ['Semester', (row) => row.semester],
        ['Section', (row) => row.section],
      ]}
      data={data}
    />
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
        // { key: 'phone', label: 'Phone' },
        { key: 'department', label: 'Department', required: true },
      ]}
      columns={[
        ['Login ID', (row) => row.faculty_login_id],
        ['Name', (row) => row.name],
        ['Email', (row) => row.email],
        ['Department', (row) => row.department],
        // ['Phone', (row) => row.phone || '-'],
      ]}
      data={data}
    />
  );
}

function SubjectSection({ data, groups, reload }) {
  return (
    <CrudSection
      title="Subjects"
      table="subjects"
      emptyForm={emptySubject}
      reload={reload}
      transformPayload={(form) => {
        const selectedGroup = groups.find((group) => group.id === form.class_id);
        if (!selectedGroup) return null;

        return {
          name: form.name,
          code: form.code,
          department: selectedGroup.department,
          semester: selectedGroup.semester,
          section: selectedGroup.section,
        };
      }}
      fields={[
        { key: 'name', label: 'Subject Name', required: true },
        { key: 'code', label: 'Code', required: true },
        {
          key: 'class_id',
          label: 'Class',
          type: 'select',
          required: true,
          options: groups.map((group) => ({
            value: group.id,
            label: `${group.department} - Semester ${group.semester} - Section ${group.section}`,
          })),
        },
      ]}
      columns={[
        ['Subject', (row) => row.name],
        ['Code', (row) => row.code],
        ['Department', (row) => row.department],
        ['Semester', (row) => row.semester],
        ['Section', (row) => row.section ?? '-'],
      ]}
      data={data}
    />
  );
}

function StudentSection({ data, groups, reload }) {
  const [groupId, setGroupId] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [excelRows, setExcelRows] = useState([]);
  const [excelFileName, setExcelFileName] = useState('');
  const [excelMessage, setExcelMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const selectedGroup = groups.find((group) => group.id === groupId);
  const visibleStudents = data.filter((student) => student.group_id === groupId);

  const resetExcelUpload = () => {
    setExcelRows([]);
    setExcelFileName('');
    setExcelMessage('');
  };

  const selectGroup = (nextGroupId) => {
    setGroupId(nextGroupId);
    resetExcelUpload();
  };

  const buildStudentRows = (rows) => rows.map(({ roll_no, name }) => ({
    roll_no,
    name,
    // email: email || null,
    // phone: phone || null,
    department: selectedGroup.department,
    semester: selectedGroup.semester,
    section: selectedGroup.section,
    group_id: selectedGroup.id,
  }));

  const submit = async (event) => {
    event.preventDefault();
    if (!selectedGroup) return;

    const rows = bulkText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [roll_no, name] = line.split(',').map((item) => item.trim());
        return { roll_no, name };
      })
      .filter((row) => row.roll_no && row.name);

    if (!rows.length) return;

    setSaving(true);
    const { error } = await supabase.from('students').upsert(buildStudentRows(rows), { onConflict: 'roll_no' });
    if (error) alert(error.message);
    else {
      setBulkText('');
      await reload();
    }
    setSaving(false);
  };

  const handleExcelFile = async (event) => {
    const file = event.target.files?.[0];
    resetExcelUpload();

    if (!file) return;

    try {
      const workbook = read(await file.arrayBuffer(), { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rows = utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      const parsedRows = parseStudentRows(rows);

      setExcelFileName(file.name);
      setExcelRows(parsedRows);
      setExcelMessage(
        parsedRows.length
          ? `${parsedRows.length} valid student${parsedRows.length === 1 ? '' : 's'} ready to upload.`
          : 'No valid students found. The file must contain USN and Name columns.'
      );
    } catch (error) {
      setExcelMessage(error.message || 'Unable to read this Excel file.');
    }
  };

  const uploadExcelStudents = async () => {
    if (!selectedGroup || !excelRows.length) return;

    setUploading(true);
    const { error } = await supabase.from('students').upsert(buildStudentRows(excelRows), { onConflict: 'roll_no' });
    if (error) alert(error.message);
    else {
      setExcelRows([]);
      setExcelFileName('');
      setExcelMessage('Students uploaded successfully.');
      await reload();
    }
    setUploading(false);
  };

  const remove = async (id) => {
    const { error } = await supabase.from('students').delete().eq('id', id);
    if (error) alert(error.message);
    else await reload();
  };

  return (
    <div className="management-grid">
      <Panel title="Add Students">
        <form className="form-grid" onSubmit={submit}>
          <GroupPicker groups={groups} value={groupId} onChange={selectGroup} />
          <label>
            <span>Students</span>
            <textarea
              value={bulkText}
              onChange={(event) => setBulkText(event.target.value)}
              placeholder="USN, Name"
              required
            />
          </label>
          <button className="primary-button" type="submit" disabled={saving || !groupId || !hasSupabaseConfig}>
            {saving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
            <span>Save Students</span>
          </button>
        </form>
        {selectedGroup && (
          <div className="upload-box">
            <label>
              <span>Upload Excel File</span>
              <input type="file" accept=".xlsx,.xls" onChange={handleExcelFile} />
            </label>
            {excelFileName && <small className="upload-note">{excelFileName}</small>}
            {excelMessage && <small className="upload-note">{excelMessage}</small>}
            <button
              className="secondary-action-button"
              type="button"
              disabled={uploading || !excelRows.length || !hasSupabaseConfig}
              onClick={uploadExcelStudents}
            >
              {uploading ? <Loader2 className="spin" size={17} /> : <FileSpreadsheet size={17} />}
              <span>Upload Excel Students</span>
            </button>
          </div>
        )}
      </Panel>

      <Panel title="Students In Selected Class">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>USN</th>
                <th>Name</th>
                <th>Department</th>
                <th>Semester</th>
                <th>Section</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {visibleStudents.map((row) => (
                <tr key={row.id}>
                  <td>{row.roll_no}</td>
                  <td>{row.name}</td>
                  <td>{row.department}</td>
                  <td>{row.semester}</td>
                  <td>{row.section}</td>
                  <td>
                    <button className="danger-button" type="button" onClick={() => remove(row.id)} title="Delete">
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {!visibleStudents.length && (
                <tr>
                  <td colSpan="6" className="empty-cell">Select a class to view students.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function AttendanceSection({ data, students, subjects, groups, reload }) {
  const [filters, setFilters] = useState({ department: '', semester: '', section: '', subject_id: '', attendance_date: today });
  const [statuses, setStatuses] = useState({});
  const [saving, setSaving] = useState(false);

  const filteredGroups = useMemo(() => groups.filter((group) => {
    if (filters.department && group.department !== filters.department) return false;
    if (filters.semester && group.semester !== filters.semester) return false;
    return true;
  }), [filters.department, filters.semester, groups]);
  const classStudents = useMemo(() => students.filter((student) => (
    student.department === filters.department
    && student.semester === filters.semester
    && student.section === filters.section
  )), [filters.department, filters.section, filters.semester, students]);
  const classSubjects = useMemo(() => subjects.filter((subject) => (
    subject.department === filters.department
    && subject.semester === filters.semester
  )), [filters.department, filters.semester, subjects]);

  useEffect(() => {
    const nextStatuses = {};
    classStudents.forEach((student) => {
      const existing = data.find((row) => (
        row.student_id === student.id
        && row.subject_id === filters.subject_id
        && row.attendance_date === filters.attendance_date
      ));
      nextStatuses[student.id] = existing ? (existing.status === 'absent' ? 'absent' : 'present') : '';
    });
    setStatuses(nextStatuses);
  }, [classStudents, data, filters.attendance_date, filters.subject_id]);

  const setFilter = (key, value) => {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === 'department') {
        next.semester = '';
        next.section = '';
        next.subject_id = '';
      }
      if (key === 'semester') {
        next.section = '';
        next.subject_id = '';
      }
      return next;
    });
  };

  const mark = (studentId, status) => {
    setStatuses((current) => ({ ...current, [studentId]: status }));
  };

  const markAllPresent = () => {
    const nextStatuses = {};
    classStudents.forEach((student) => {
      nextStatuses[student.id] = 'present';
    });
    setStatuses(nextStatuses);
  };

  const saveAttendance = async (event) => {
    event.preventDefault();
    if (!filters.subject_id) {
      alert('Select a subject before saving attendance.');
      return;
    }
    if (!classStudents.length) {
      alert('Select a class with students before saving attendance.');
      return;
    }

    const hasUnmarkedStudents = classStudents.some((student) => !statuses[student.id]);
    if (hasUnmarkedStudents) {
      alert('Mark every student as present or absent before saving attendance.');
      return;
    }

    const records = classStudents.map((student) => ({
      student_id: student.id,
      subject_id: filters.subject_id,
      attendance_date: filters.attendance_date,
      status: statuses[student.id],
    }));

    setSaving(true);
    const { error } = await supabase
      .from('attendance_records')
      .upsert(records, { onConflict: 'student_id,subject_id,attendance_date' });

    if (error) alert(error.message);
    else {
      await reload();
      alert('Attendance saved successfully.');
    }
    setSaving(false);
  };

  return (
    <div className="stack">
      <Panel title="Select Class">
        <form className="filter-grid" onSubmit={saveAttendance}>
          <label>
            <span>Department</span>
            <select required value={filters.department} onChange={(event) => setFilter('department', event.target.value)}>
              <option value="">Select Department</option>
              {uniqueOptions(groups, 'department').map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label>
            <span>Semester</span>
            <select required value={filters.semester} onChange={(event) => setFilter('semester', event.target.value)}>
              <option value="">Select Semester</option>
              {uniqueOptions(groups.filter((group) => group.department === filters.department), 'semester').map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Section</span>
            <select required value={filters.section} onChange={(event) => setFilter('section', event.target.value)}>
              <option value="">Select Section</option>
              {uniqueOptions(filteredGroups.filter((group) => group.semester === filters.semester), 'section').map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Subject</span>
            <select required value={filters.subject_id} onChange={(event) => setFilter('subject_id', event.target.value)}>
              <option value="">Select Subject</option>
              {classSubjects.map((subject) => (
                <option key={subject.id} value={subject.id}>{subject.code} - {subject.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Date</span>
            <input type="date" value={filters.attendance_date} onChange={(event) => setFilter('attendance_date', event.target.value)} required />
          </label>
          <button className="secondary-action-button" type="button" onClick={markAllPresent} disabled={saving || !classStudents.length}>
            <CalendarCheck size={17} />
            <span>All Present</span>
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? <Loader2 className="spin" size={17} /> : <Save size={17} />}
            <span>Save Attendance</span>
          </button>
        </form>
      </Panel>

      <Panel title="Mark Attendance">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>USN</th>
                <th>Student</th>
                <th>Present</th>
                <th>Absent</th>
              </tr>
            </thead>
            <tbody>
              {classStudents.map((student) => (
                <tr key={student.id}>
                  <td>{student.roll_no}</td>
                  <td>{student.name}</td>
                  <td>
                    <input
                      className="mark-check"
                      type="checkbox"
                      checked={statuses[student.id] === 'present'}
                      onChange={() => mark(student.id, 'present')}
                    />
                  </td>
                  <td>
                    <input
                      className="mark-check"
                      type="checkbox"
                      checked={statuses[student.id] === 'absent'}
                      onChange={() => mark(student.id, 'absent')}
                    />
                  </td>
                </tr>
              ))}
              {!classStudents.length && (
                <tr>
                  <td colSpan="4" className="empty-cell">Select department, semester, and section to load students.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function CrudSection({ title, table, emptyForm, fields, columns, data, reload, transformPayload }) {
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    const normalizedForm = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, value === '' ? null : value]));
    const payload = transformPayload ? transformPayload(normalizedForm) : normalizedForm;
    if (!payload) {
      alert('Select an existing class before saving.');
      setSaving(false);
      return;
    }
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

function ReportsSection({ data, attendance, query, setQuery, readonly }) {
  const [filters, setFilters] = useState({
    department: '',
    semester: '',
    section: '',
    subject_id: '',
    month: today.slice(0, 7),
  });
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const filteredSemesters = data.filter((row) => row.department === filters.department);
  const filteredSections = filteredSemesters.filter((row) => row.semester === filters.semester);
  const filteredSubjects = filteredSections
    .filter((row) => row.section === filters.section)
    .filter((row, index, rows) => rows.findIndex((item) => item.subject_id === row.subject_id) === index)
    .sort((a, b) => String(a.subject_code).localeCompare(String(b.subject_code), undefined, { numeric: true }));
  const hasReportSelection = filters.department && filters.semester && filters.section && filters.subject_id;
  const eligibleStudents = hasReportSelection
    ? data.filter((row) => (
      row.department === filters.department
      && row.semester === filters.semester
      && row.section === filters.section
      && row.subject_id === filters.subject_id
    ))
    : [];
  const normalizedQuery = query.trim().toLowerCase();
  const searchTokens = normalizedQuery.split(/[^a-z0-9]+/).filter(Boolean);
  const searchResults = normalizedQuery
    ? eligibleStudents.filter((row) => {
      const haystack = `${row.student_name} ${row.roll_no}`.toLowerCase();
      return searchTokens.every((token) => haystack.includes(token));
    }).slice(0, 8)
    : [];
  const selectedStudent = eligibleStudents.find((row) => row.student_id === selectedStudentId);
  const monthlyAttendance = selectedStudent
    ? attendance.filter((row) => (
      row.student_id === selectedStudent.student_id
      && row.subject_id === filters.subject_id
      && filters.month
      && String(row.attendance_date).startsWith(filters.month)
    ))
    : [];
  const attendanceByDate = new Map(monthlyAttendance.map((row) => [row.attendance_date, row.status]));
  const presentCount = monthlyAttendance.filter((row) => row.status === 'present').length;
  const absentCount = monthlyAttendance.filter((row) => row.status === 'absent').length;
  const attendancePercentage = monthlyAttendance.length
    ? Math.round((presentCount / monthlyAttendance.length) * 100)
    : 0;
  const calendarDays = buildMonthCalendar(filters.month);
  const monthLabel = formatMonthLabel(filters.month);

  const setFilter = (key, value) => {
    setFilters((current) => {
      const next = { ...current, [key]: value };
      if (key === 'department') {
        next.semester = '';
        next.section = '';
        next.subject_id = '';
      }
      if (key === 'semester') {
        next.section = '';
        next.subject_id = '';
      }
      if (key === 'section') {
        next.subject_id = '';
      }
      return next;
    });

    if (key !== 'month') {
      setSelectedStudentId('');
      setSearchOpen(false);
      setQuery('');
    }
  };

  return (
    <Panel title={readonly ? 'Attendance Reports' : 'Attendance Reports'}>
      <div className="filter-grid">
        <label>
          <span>Department</span>
          <select required value={filters.department} onChange={(event) => setFilter('department', event.target.value)}>
            <option value="">Select Department</option>
            {uniqueOptions(data, 'department').map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Semester</span>
          <select required value={filters.semester} onChange={(event) => setFilter('semester', event.target.value)}>
            <option value="">Select Semester</option>
            {uniqueOptions(filteredSemesters, 'semester').map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Section</span>
          <select required value={filters.section} onChange={(event) => setFilter('section', event.target.value)}>
            <option value="">Select Section</option>
            {uniqueOptions(filteredSections, 'section').map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label>
          <span>Subject</span>
          <select required value={filters.subject_id} onChange={(event) => setFilter('subject_id', event.target.value)}>
            <option value="">Select Subject</option>
            {filteredSubjects.map((subject) => (
              <option key={subject.subject_id} value={subject.subject_id}>{subject.subject_code} - {subject.subject_name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Month</span>
          <input type="month" required value={filters.month} onChange={(event) => setFilter('month', event.target.value)} />
        </label>
      </div>
      <div className="student-search">
        <div className="search-row">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelectedStudentId('');
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setSearchOpen(false)}
            placeholder="Search student or USN..."
            disabled={!hasReportSelection}
            role="combobox"
            aria-expanded={searchOpen && Boolean(normalizedQuery)}
            aria-controls="student-search-results"
          />
        </div>
        {searchOpen && normalizedQuery && (
          <div className="student-search-results" id="student-search-results" role="listbox">
            {searchResults.map((row) => (
              <button
                key={row.student_id}
                type="button"
                role="option"
                aria-selected={row.student_id === selectedStudentId}
                onMouseDown={(event) => {
                  event.preventDefault();
                  setSelectedStudentId(row.student_id);
                  setQuery(`${row.roll_no} - ${row.student_name}`);
                  setSearchOpen(false);
                }}
              >
                <strong>{row.student_name}</strong>
                <span>{row.roll_no}</span>
              </button>
            ))}
            {!searchResults.length && <div className="student-search-empty">No matching students found.</div>}
          </div>
        )}
      </div>
      {selectedStudent ? (
        <div className="attendance-report-dashboard">
          <div className="attendance-report-overview">
            <div className="attendance-report-student">
              <span>{selectedStudent.roll_no}</span>
              <strong>{selectedStudent.student_name}</strong>
              <small>
                {selectedStudent.department} | Semester {selectedStudent.semester} | Section {selectedStudent.section}
                {' | '}
                {selectedStudent.subject_code} - {selectedStudent.subject_name}
              </small>
            </div>
            <dl className="attendance-report-stats">
              <div>
                <dt>Present</dt>
                <dd>{presentCount}</dd>
              </div>
              <div>
                <dt>Absent</dt>
                <dd>{absentCount}</dd>
              </div>
              <div>
                <dt>Attendance</dt>
                <dd>{attendancePercentage}%</dd>
              </div>
            </dl>
          </div>

          <div className="attendance-calendar-header">
            <strong>{monthLabel}</strong>
            <div className="attendance-calendar-legend" aria-label="Attendance status legend">
              <span><i className="present" />Present</span>
              <span><i className="absent" />Absent</span>
            </div>
          </div>

          <div className="attendance-calendar" role="grid" aria-label={`${selectedStudent.student_name} attendance for ${monthLabel}`}>
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div className="attendance-calendar-weekday" role="columnheader" key={day}>{day}</div>
            ))}
            {calendarDays.map((day) => {
              const status = day.inCurrentMonth ? attendanceByDate.get(day.dateKey) : '';
              const statusLabel = status ? `, ${status}` : ', no attendance record';

              return (
                <div
                  className={`attendance-calendar-day${day.inCurrentMonth ? '' : ' outside-month'}`}
                  role="gridcell"
                  aria-label={`${day.label}${statusLabel}`}
                  key={day.dateKey}
                >
                  <span className={`attendance-calendar-date${status ? ` ${status}` : ''}`}>{day.day}</span>
                </div>
              );
            })}
          </div>
          {!monthlyAttendance.length && (
            <div className="attendance-calendar-empty">No attendance records for {monthLabel}.</div>
          )}
        </div>
      ) : (
        <div className="attendance-report-empty">
          {hasReportSelection
            ? 'Search and select a student to view the monthly attendance report.'
            : 'Select department, semester, section, and subject to load attendance reports.'}
        </div>
      )}
    </Panel>
  );
}

function GroupPicker({ groups, value, onChange }) {
  return (
    <label>
      <span>Department / Semester / Section</span>
      <select required value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Select Class</option>
        {groups.map((group) => (
          <option key={group.id} value={group.id}>
            {group.department} - Semester {group.semester} - Section {group.section}
          </option>
        ))}
      </select>
    </label>
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

function uniqueOptions(rows, key) {
  return [...new Set(rows.map((row) => row[key]).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }))
    .map((value) => ({ value, label: value }));
}

function buildMonthCalendar(monthValue) {
  const [year, month] = String(monthValue).split('-').map(Number);
  if (!year || !month) return [];

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(year, month - 1, index - firstWeekday + 1);
    const dateKey = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');

    return {
      dateKey,
      day: date.getDate(),
      inCurrentMonth: date.getMonth() === month - 1,
      label: date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    };
  });
}

function formatMonthLabel(monthValue) {
  const [year, month] = String(monthValue).split('-').map(Number);
  if (!year || !month) return '';
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function parseStudentRows(rows) {
  const normalizedRows = rows.map((row) => row.map((cell) => String(cell ?? '').trim()));
  const headerIndex = normalizedRows.findIndex((row) => {
    const cells = row.map(normalizeHeader);
    return cells.some((cell) => ['usn', 'rollno', 'rollnumber'].includes(cell)) && cells.includes('name');
  });
  const header = headerIndex >= 0 ? normalizedRows[headerIndex].map(normalizeHeader) : [];
  const usnIndex = headerIndex >= 0
    ? header.findIndex((cell) => ['usn', 'rollno', 'rollnumber'].includes(cell))
    : 0;
  const nameIndex = headerIndex >= 0 ? header.findIndex((cell) => cell === 'name') : 1;
  const dataRows = normalizedRows.slice(headerIndex >= 0 ? headerIndex + 1 : 0);

  return dataRows
    .map((row) => ({
      roll_no: row[usnIndex]?.trim(),
      name: row[nameIndex]?.trim(),
    }))
    .filter((row) => row.roll_no && row.name);
}

function normalizeHeader(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function roleLabel(role) {
  if (role.role === 'admin') return 'Admin Console';
  if (role.role === 'faculty') return 'Faculty Console';
  return 'Student Reports';
}

function titleFor(tab) {
  const titles = {
    dashboard: 'Admin Dashboard',
    groups: 'Manage Classes',
    faculties: 'Manage Faculty',
    subjects: 'Manage Subjects',
    students: 'Manage Students',
    attendance: 'Class Attendance',
    reports: 'Reports',
  };
  return titles[tab] ?? 'Reports';
}

export default App;

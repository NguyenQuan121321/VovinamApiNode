import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import otplib from 'otplib';
import {
  BASE_URL,
  RUN_ID,
  request,
  recordTest,
  testResults,
  operationCoverage,
  openapiDoc,
  createdResources,
  registerCreatedResource,
  isCreatedResource,
  leakScanResults,
  evaluateDocsAssertion,
  evaluateRateLimitAssertion,
  calculateCoverageSummary,
  redactSecrets,
} from './live-runner-base.mjs';

// =====================================================================
// PHASE 1 — RUNTIME CREDENTIALS & PRECONDITIONS (F1/F2)
// =====================================================================
const adminEmail = process.env.LIVE_UAT_ADMIN_EMAIL || 'uat-admin@example.com';
const adminPassword = process.env.LIVE_UAT_ADMIN_PASSWORD;
let totpSecret = process.env.LIVE_UAT_ADMIN_TOTP_SECRET;

if (!totpSecret && fs.existsSync('test/uat/uat-admin-totp-secret.txt')) {
  try {
    totpSecret = fs.readFileSync('test/uat/uat-admin-totp-secret.txt', 'utf8').trim();
  } catch {
    // ignore read error
  }
}

let runStatus = 'INITIALIZING';
let cleanupStatus = 'NOT_RUN';
const syntheticFinancialResidue = {
  invoices: [],
  payments: [],
};

async function getBootstrapAdminToken() {
  if (!adminPassword) {
    console.error('\n[SAFETY GATE BLOCKED] Missing required environment variable: LIVE_UAT_ADMIN_PASSWORD');
    console.error('The live Render UAT admin credential must come only from runtime environment variables.');
    console.error('The human owner must rotate/revoke the credential on Render before running live UAT.');
    recordTest(
      1,
      'Safety Gate: Runtime credentials present',
      'LIVE_UAT_ADMIN_PASSWORD set in environment',
      'MISSING',
      'BLOCKED',
      'LIVE_UAT_ADMIN_PASSWORD required. Live run blocked per Phase 1/15 safety contract.',
      null,
      false,
    );
    throw new Error('BLOCKED: LIVE_UAT_ADMIN_PASSWORD is missing');
  }

  const loginRes = await request('POST', '/api/v1/auth/login', {
    body: { email: adminEmail, password: adminPassword },
  });

  if (!loginRes.ok && loginRes.status !== 200) {
    recordTest(
      1,
      'Admin bootstrap authentication',
      200,
      loginRes.status,
      'FAIL',
      `Login failed for bootstrap operator (${adminEmail}): HTTP ${loginRes.status}`,
    );
    throw new Error(`Bootstrap admin login failed with status ${loginRes.status}`);
  }

  if (loginRes.json?.data?.mfaRequired === false) {
    recordTest(1, 'Admin bootstrap authentication', 200, loginRes.status, 'PASS', 'Admin token acquired');
    return loginRes.json.data.tokens.accessToken;
  }

  if (!totpSecret) {
    console.error('\n[SAFETY GATE BLOCKED] MFA is required for admin but LIVE_UAT_ADMIN_TOTP_SECRET is missing');
    recordTest(
      1,
      'Admin MFA verification',
      'TOTP code generated',
      'MISSING_SECRET',
      'BLOCKED',
      'MFA required by live server but TOTP secret is not provided',
      'AuthController_mfaLoginVerify',
      false,
    );
    throw new Error('BLOCKED: LIVE_UAT_ADMIN_TOTP_SECRET is missing');
  }

  const code = otplib.authenticator.generate(totpSecret);
  const mfaRes = await request('POST', '/api/v1/auth/mfa/login-verify', {
    body: { mfaToken: loginRes.json?.data?.mfaToken, code },
  });

  const mfaOk = mfaRes.status === 200 && !!mfaRes.json?.data?.tokens?.accessToken;
  recordTest(
    1,
    'Admin MFA login verify',
    200,
    mfaRes.status,
    mfaOk ? 'PASS' : 'FAIL',
    mfaOk ? 'MFA satisfied for admin bootstrap' : 'MFA verification failed',
    'AuthController_mfaLoginVerify',
    true,
  );

  if (!mfaOk) {
    throw new Error(`Admin MFA verification failed with HTTP ${mfaRes.status}`);
  }

  return mfaRes.json.data.tokens.accessToken;
}

// Tokens & IDs for synthetic graph
let adminToken = '';
let adminUserId = '';

let instructorAToken = '';
let instructorAUserId = '';
let instructorBToken = '';
let instructorBUserId = '';

let studentAToken = '';
let studentAUserId = '';
let studentAProfileId = '';

let studentBToken = '';
let studentBUserId = '';
let studentBProfileId = '';

let parentToken = '';
let parentUserId = '';
let childStudentProfileId = '';

let classAId = '';
let classBId = '';
let scheduleAId = '';
let enrollmentAId = '';
let attendanceSessionAId = '';

let testBeltRankId = 0;
let examAId = '';
let examRegistrationAId = '';

let manualInvoiceId = '';
let manualDiscountId = '';
let leaveRequestId = '';
let promotionProposalId = '';
let evaluationId = '';
let announcementId = '';

// Synthetic password used for all ephemeral actors in this specific run
const ACTOR_PASSWORD = `Uat#${RUN_ID.slice(0, 8)}!2026`;

// =====================================================================
// PHASE 6 — GUARANTEED CLEANUP (F10)
// =====================================================================
let cleanupExecuted = false;

async function performGuaranteedCleanup(reason = 'NORMAL') {
  if (cleanupExecuted) return;
  cleanupExecuted = true;
  console.log(`\n=======================================================`);
  console.log(`[CLEANUP] Executing guaranteed cleanup (Reason: ${reason})...`);
  console.log(`=======================================================`);

  let errors = 0;
  if (!adminToken) {
    console.log('[CLEANUP] No admin token available; skipping remote API cleanup.');
    const anyCreated = Object.values(createdResources).some((s) => s.size > 0);
    cleanupStatus = anyCreated ? 'CLEANUP PARTIAL' : 'CLEANUP COMPLETED';
    console.log(`[CLEANUP] Status: ${cleanupStatus}`);
    writeResultsJson();
    return;
  }

  // 1. Delete synthetic announcements
  for (const annId of Array.from(createdResources.announcements)) {
    try {
      const res = await request('DELETE', `/api/v1/announcements/${annId}`, { token: adminToken });
      if (res.status === 200 || res.status === 404) createdResources.announcements.delete(annId);
    } catch {
      errors++;
    }
  }

  // 2. Delete synthetic evaluations
  for (const evalId of Array.from(createdResources.evaluations)) {
    try {
      const res = await request('DELETE', `/api/v1/evaluations/${evalId}`, { token: adminToken });
      if (res.status === 200 || res.status === 404) createdResources.evaluations.delete(evalId);
    } catch {
      errors++;
    }
  }

  // 3. Delete synthetic leave requests
  for (const leaveId of Array.from(createdResources.leaves)) {
    try {
      const res = await request('DELETE', `/api/v1/leave-requests/${leaveId}`, { token: adminToken });
      if (res.status === 200 || res.status === 404) createdResources.leaves.delete(leaveId);
    } catch {
      errors++;
    }
  }

  // 4. Delete synthetic discounts
  for (const discId of Array.from(createdResources.discounts)) {
    try {
      const res = await request('DELETE', `/api/v1/discounts/${discId}`, { token: adminToken });
      if (res.status === 200 || res.status === 404) createdResources.discounts.delete(discId);
    } catch {
      errors++;
    }
  }

  // 5. Remove synthetic schedules
  for (const schedId of Array.from(createdResources.schedules)) {
    try {
      if (classAId) {
        const res = await request('DELETE', `/api/v1/classes/${classAId}/schedules/${schedId}`, {
          token: adminToken,
        });
        if (res.status === 200 || res.status === 404) createdResources.schedules.delete(schedId);
      }
    } catch {
      errors++;
    }
  }

  // 6. Remove synthetic enrollments
  for (const enrId of Array.from(createdResources.enrollments)) {
    try {
      const res = await request('DELETE', `/api/v1/enrollments/${enrId}`, { token: adminToken });
      if (res.status === 200 || res.status === 404) createdResources.enrollments.delete(enrId);
    } catch {
      errors++;
    }
  }

  // 7. Soft-delete synthetic students
  for (const stuId of Array.from(createdResources.students)) {
    try {
      const res = await request('DELETE', `/api/v1/students/${stuId}`, { token: adminToken });
      if (res.status === 200 || res.status === 404) createdResources.students.delete(stuId);
    } catch {
      errors++;
    }
  }

  // 8. Deactivate synthetic users
  for (const usrId of Array.from(createdResources.users)) {
    try {
      const res = await request('DELETE', `/api/v1/users/${usrId}`, { token: adminToken });
      if (res.status === 200 || res.status === 404) createdResources.users.delete(usrId);
    } catch {
      errors++;
    }
  }

  // Preserved by design: financial records (invoices, payments) are historical and never hard-deleted.
  if (createdResources.invoices.size > 0 || createdResources.payments.size > 0) {
    console.log(
      `[FINANCIAL INTEGRITY] Synthetic financial residue preserved: ${createdResources.invoices.size} invoices, ${createdResources.payments.size} payments.`,
    );
  }

  cleanupStatus = errors === 0 ? 'CLEANUP COMPLETED' : 'CLEANUP PARTIAL';
  console.log(`[CLEANUP] Status: ${cleanupStatus}`);

  // Always write results JSON upon exit
  writeResultsJson();
}

function writeResultsJson() {
  const coverage = calculateCoverageSummary(operationCoverage);
  const outPath = 'test/uat/live-uat-results.json';
  const data = {
    runId: RUN_ID,
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    runStatus,
    cleanupStatus,
    totalTests: testResults.length,
    passCount: coverage.pass,
    failCount: coverage.fail,
    blockedCount: coverage.blocked,
    manualCount: coverage.manualRequired,
    notSafeCount: coverage.notSafeToAutomate,
    coveredCount: coverage.coveredCount,
    totalOperations: coverage.total,
    executedOperations: coverage.executed,
    financialResidue: {
      invoices: Array.from(createdResources.invoices),
      payments: Array.from(createdResources.payments),
    },
    createdResourcesSummary: {
      users: Array.from(createdResources.users),
      students: Array.from(createdResources.students),
      classes: Array.from(createdResources.classes),
      schedules: Array.from(createdResources.schedules),
      enrollments: Array.from(createdResources.enrollments),
      attendanceSessions: Array.from(createdResources.attendanceSessions),
      beltRanks: Array.from(createdResources.beltRanks),
      exams: Array.from(createdResources.exams),
      registrations: Array.from(createdResources.registrations),
      invoices: Array.from(createdResources.invoices),
      payments: Array.from(createdResources.payments),
      announcements: Array.from(createdResources.announcements),
      leaves: Array.from(createdResources.leaves),
      evaluations: Array.from(createdResources.evaluations),
      proposals: Array.from(createdResources.proposals),
      discounts: Array.from(createdResources.discounts),
    },
    leakScan: {
      scannedCount: leakScanResults.scannedCount,
      leaksDetected: leakScanResults.leaks.length,
      leaks: leakScanResults.leaks,
    },
    testResults,
    operations: Array.from(operationCoverage.values()),
  };

  try {
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`[REPORT] Wrote live UAT results to ${outPath}`);
  } catch (err) {
    console.error(`[REPORT ERROR] Failed to write results JSON:`, err.message);
  }
}

// Process signal handlers
process.on('SIGINT', async () => {
  console.log('\n[SIGNAL] Received SIGINT. Terminating run gracefully...');
  runStatus = 'RUN ABORTED';
  await performGuaranteedCleanup('SIGINT');
  process.exit(130);
});

process.on('SIGTERM', async () => {
  console.log('\n[SIGNAL] Received SIGTERM. Terminating run gracefully...');
  runStatus = 'RUN ABORTED';
  await performGuaranteedCleanup('SIGTERM');
  process.exit(143);
});

// =====================================================================
// MAIN RUNNER
// =====================================================================
async function run() {
  console.log(`=======================================================`);
  console.log(`VOVINAM API NODE — LIVE RENDER UAT REPAIRED RUNNER`);
  console.log(`TARGET: ${BASE_URL}`);
  console.log(`RUN ID: ${RUN_ID}`);
  console.log(`TIMESTAMP: ${new Date().toISOString()}`);
  console.log(`=======================================================\n`);

  try {
    // -----------------------------------------------------------------
    // PHASE 0 — LIVE PRE-FLIGHT
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 0: LIVE PRE-FLIGHT ---`);

    // 1. GET /healthz
    const healthz = await request('GET', '/healthz');
    const healthzOk = healthz.status === 200 && healthz.json?.data?.status === 'ok';
    recordTest(
      0,
      'GET /healthz liveness probe',
      200,
      healthz.status,
      healthzOk ? 'PASS' : 'FAIL',
      `Latency: ${healthz.latency}ms`,
      'HealthController_getLiveness',
      true,
    );

    // 2. GET /readyz
    const readyz = await request('GET', '/readyz');
    const readyzOk =
      readyz.status === 200 && readyz.json?.data?.status === 'ok' && readyz.json?.data?.database === 'up';
    recordTest(
      0,
      'GET /readyz readiness probe',
      200,
      readyz.status,
      readyzOk ? 'PASS' : 'FAIL',
      `Latency: ${readyz.latency}ms, DB: ${readyz.json?.data?.database}`,
      'HealthController_getReadiness',
      true,
    );

    if (!readyzOk) {
      console.error('FATAL: readyz failed. STOPPING execution per Phase 0 contract.');
      runStatus = 'RUN ABORTED';
      return;
    }

    // 3. GET /metrics without token -> 401
    const metricsNoToken = await request('GET', '/metrics');
    recordTest(
      0,
      'GET /metrics without token returns 401',
      401,
      metricsNoToken.status,
      metricsNoToken.status === 401 ? 'PASS' : 'FAIL',
      'Protected metrics endpoint requires bearer token',
      'MetricsController_getMetrics',
      true,
    );

    // 4. GET /docs (Phase 8 fail-closed assertion)
    const docs = await request('GET', '/docs');
    const docsResult = evaluateDocsAssertion(docs.status);
    recordTest(
      0,
      'GET /docs live documentation endpoint',
      200,
      docs.status,
      docsResult,
      docsResult === 'PASS'
        ? 'Swagger UI served (Staging/Integration environment posture)'
        : `Unexpected /docs status ${docs.status}`,
    );

    // 5. GET /docs-json (Phase 8 fail-closed assertion)
    const docsJson = await request('GET', '/docs-json');
    const docsJsonResult = evaluateDocsAssertion(docsJson.status);
    recordTest(
      0,
      'GET /docs-json live OpenAPI document',
      200,
      docsJson.status,
      docsJsonResult,
      docsJsonResult === 'PASS'
        ? `OpenAPI document served, paths: ${Object.keys(docsJson.json?.paths || {}).length}`
        : `Unexpected /docs-json status ${docsJson.status}`,
    );

    // -----------------------------------------------------------------
    // PHASE 1 — AUTH BOOTSTRAP (Runtime Credentials Only)
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 1: ADMIN BOOTSTRAP ---`);
    adminToken = await getBootstrapAdminToken();

    // Dynamically retrieve operator admin user ID via /auth/me (NO hardcoded UUIDs!)
    const adminMe = await request('GET', '/api/v1/auth/me', { token: adminToken });
    if (adminMe.status === 200 && adminMe.json?.data?.id) {
      adminUserId = adminMe.json.data.id;
      console.log(`[BOOT] Bootstrap operator authenticated: ID ${adminUserId}`);
    } else {
      throw new Error(`Failed to retrieve bootstrap operator identity via /auth/me`);
    }

    // -----------------------------------------------------------------
    // PHASE 2 & 3 — BUILD COMPLETE SYNTHETIC ACTOR GRAPH
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 2 & 3: SYNTHETIC ACTOR GRAPH SETUP ---`);

    // 1. Instructor A
    const instrAEmail = `live-uat-instr-a-${RUN_ID}@example.com`;
    const instrACreate = await request('POST', '/api/v1/users', {
      token: adminToken,
      body: { email: instrAEmail, password: ACTOR_PASSWORD, role: 'INSTRUCTOR' },
    });
    instructorAUserId = instrACreate.json?.data?.id;
    registerCreatedResource('users', instructorAUserId);
    recordTest(
      2,
      'Create synthetic Instructor A user',
      201,
      instrACreate.status,
      instrACreate.status === 201 ? 'PASS' : 'FAIL',
      `Instructor A ID: ${instructorAUserId}`,
      'AdminUsersController_create',
      true,
    );

    const instrALogin = await request('POST', '/api/v1/auth/login', {
      body: { email: instrAEmail, password: ACTOR_PASSWORD },
    });
    instructorAToken = instrALogin.json?.data?.tokens?.accessToken;
    recordTest(
      2,
      'Login synthetic Instructor A',
      200,
      instrALogin.status,
      instrALogin.status === 200 && !!instructorAToken ? 'PASS' : 'FAIL',
      'Instructor A session established',
      'AuthController_login',
      true,
    );

    // 2. Instructor B (Foreign instructor for IDOR / cross-instructor authorization tests)
    const instrBEmail = `live-uat-instr-b-${RUN_ID}@example.com`;
    const instrBCreate = await request('POST', '/api/v1/users', {
      token: adminToken,
      body: { email: instrBEmail, password: ACTOR_PASSWORD, role: 'INSTRUCTOR' },
    });
    instructorBUserId = instrBCreate.json?.data?.id;
    registerCreatedResource('users', instructorBUserId);
    recordTest(
      2,
      'Create synthetic Instructor B user (for foreign authorization tests)',
      201,
      instrBCreate.status,
      instrBCreate.status === 201 ? 'PASS' : 'FAIL',
      `Instructor B ID: ${instructorBUserId}`,
    );

    const instrBLogin = await request('POST', '/api/v1/auth/login', {
      body: { email: instrBEmail, password: ACTOR_PASSWORD },
    });
    instructorBToken = instrBLogin.json?.data?.tokens?.accessToken;

    // 3. Student A (User + Linked Profile)
    const studentAEmail = `live-uat-student-a-${RUN_ID}@example.com`;
    const studentACreate = await request('POST', '/api/v1/users', {
      token: adminToken,
      body: { email: studentAEmail, password: ACTOR_PASSWORD, role: 'STUDENT' },
    });
    studentAUserId = studentACreate.json?.data?.id;
    registerCreatedResource('users', studentAUserId);

    const studentALogin = await request('POST', '/api/v1/auth/login', {
      body: { email: studentAEmail, password: ACTOR_PASSWORD },
    });
    studentAToken = studentALogin.json?.data?.tokens?.accessToken;
    const studentARefresh = studentALogin.json?.data?.tokens?.refreshToken;

    const studentAProfileCreate = await request('POST', '/api/v1/students', {
      token: adminToken,
      body: {
        fullName: `UAT Student A ${RUN_ID.slice(0, 6)}`,
        dob: '2005-06-15',
        gender: 'MALE',
        phone: '+84901111111',
        address: '123 Synthetic Street, District 1',
        linkedUserEmail: studentAEmail,
      },
    });
    studentAProfileId = studentAProfileCreate.json?.data?.id;
    registerCreatedResource('students', studentAProfileId);
    recordTest(
      2,
      'Create synthetic Student A profile with linked account',
      201,
      studentAProfileCreate.status,
      studentAProfileCreate.status === 201 && !!studentAProfileId ? 'PASS' : 'FAIL',
      `Student A Profile ID: ${studentAProfileId}`,
      'StudentsController_create',
      true,
    );

    // 4. Student B (Foreign student for IDOR tests)
    const studentBEmail = `live-uat-student-b-${RUN_ID}@example.com`;
    const studentBCreate = await request('POST', '/api/v1/users', {
      token: adminToken,
      body: { email: studentBEmail, password: ACTOR_PASSWORD, role: 'STUDENT' },
    });
    studentBUserId = studentBCreate.json?.data?.id;
    registerCreatedResource('users', studentBUserId);

    const studentBLogin = await request('POST', '/api/v1/auth/login', {
      body: { email: studentBEmail, password: ACTOR_PASSWORD },
    });
    studentBToken = studentBLogin.json?.data?.tokens?.accessToken;

    const studentBProfileCreate = await request('POST', '/api/v1/students', {
      token: adminToken,
      body: {
        fullName: `UAT Student B ${RUN_ID.slice(0, 6)}`,
        dob: '2006-07-20',
        gender: 'FEMALE',
        phone: '+84902222222',
        address: '456 Synthetic Avenue, District 3',
        linkedUserEmail: studentBEmail,
      },
    });
    studentBProfileId = studentBProfileCreate.json?.data?.id;
    registerCreatedResource('students', studentBProfileId);

    // 5. Parent User & Unlinked Minor Child
    const parentEmail = `live-uat-parent-${RUN_ID}@example.com`;
    const parentCreate = await request('POST', '/api/v1/users', {
      token: adminToken,
      body: { email: parentEmail, password: ACTOR_PASSWORD, role: 'PARENT' },
    });
    parentUserId = parentCreate.json?.data?.id;
    registerCreatedResource('users', parentUserId);

    const parentLogin = await request('POST', '/api/v1/auth/login', {
      body: { email: parentEmail, password: ACTOR_PASSWORD },
    });
    parentToken = parentLogin.json?.data?.tokens?.accessToken;

    const childCreate = await request('POST', '/api/v1/students', {
      token: adminToken,
      body: {
        fullName: `UAT Child ${RUN_ID.slice(0, 6)}`,
        dob: '2016-08-10',
        gender: 'MALE',
        emergencyContactName: 'UAT Parent',
        emergencyContactPhone: '+84909999999',
      },
    });
    childStudentProfileId = childCreate.json?.data?.id;
    registerCreatedResource('students', childStudentProfileId);

    // 6. Class A (taught by Instructor A) & Class B (taught by Instructor B)
    const classACreate = await request('POST', '/api/v1/classes', {
      token: adminToken,
      body: { name: `UAT Class A ${RUN_ID.slice(0, 6)}`, instructorId: instructorAUserId, capacity: 25 },
    });
    classAId = classACreate.json?.data?.id;
    registerCreatedResource('classes', classAId);
    recordTest(
      2,
      'Create synthetic Class A (taught by Instructor A)',
      201,
      classACreate.status,
      classACreate.status === 201 && !!classAId ? 'PASS' : 'FAIL',
      `Class A ID: ${classAId}`,
      'ClassesController_create',
      true,
    );

    const classBCreate = await request('POST', '/api/v1/classes', {
      token: adminToken,
      body: { name: `UAT Class B ${RUN_ID.slice(0, 6)}`, instructorId: instructorBUserId, capacity: 25 },
    });
    classBId = classBCreate.json?.data?.id;
    registerCreatedResource('classes', classBId);

    // 7. Schedule for Class A
    const schedCreate = await request('POST', `/api/v1/classes/${classAId}/schedules`, {
      token: adminToken,
      body: { dayOfWeek: 2, startTime: '18:00', endTime: '19:30' },
    });
    scheduleAId = schedCreate.json?.data?.id;
    registerCreatedResource('schedules', scheduleAId);
    recordTest(
      2,
      'Create schedule for synthetic Class A',
      201,
      schedCreate.status,
      schedCreate.status === 201 && !!scheduleAId ? 'PASS' : 'FAIL',
      `Schedule ID: ${scheduleAId}`,
      'ClassesController_addSchedule',
      true,
    );

    // 8. Enroll Student A in Class A
    const enrCreate = await request('POST', `/api/v1/classes/${classAId}/enrollments`, {
      token: adminToken,
      body: { studentId: studentAProfileId },
    });
    enrollmentAId = enrCreate.json?.data?.id;
    registerCreatedResource('enrollments', enrollmentAId);
    recordTest(
      2,
      'Enroll synthetic Student A into Class A',
      201,
      enrCreate.status,
      enrCreate.status === 201 && !!enrollmentAId ? 'PASS' : 'FAIL',
      `Enrollment ID: ${enrollmentAId}`,
      'EnrollmentsController_create',
      true,
    );

    // -----------------------------------------------------------------
    // PHASE 4 — AUTH & SESSION LIFECYCLE
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 4: AUTH & SESSION LIFECYCLE ---`);

    // Student calls /auth/me
    const meRes = await request('GET', '/api/v1/auth/me', { token: studentAToken });
    recordTest(
      4,
      'Student GET /auth/me',
      200,
      meRes.status,
      meRes.status === 200 && meRes.json?.data?.role === 'STUDENT' ? 'PASS' : 'FAIL',
      `Role verified: ${meRes.json?.data?.role}`,
      'AuthController_me',
      true,
    );

    // Student sessions list
    const sessionsRes = await request('GET', '/api/v1/auth/sessions', { token: studentAToken });
    recordTest(
      4,
      'Student GET /auth/sessions',
      200,
      sessionsRes.status,
      sessionsRes.status === 200 && Array.isArray(sessionsRes.json?.data) ? 'PASS' : 'FAIL',
      `Active sessions: ${sessionsRes.json?.data?.length}`,
      'AuthController_sessions',
      true,
    );

    // Refresh token rotation
    if (studentARefresh) {
      const refreshRes = await request('POST', '/api/v1/auth/refresh', {
        body: { refreshToken: studentARefresh },
      });
      const refreshOk = refreshRes.status === 200 && !!refreshRes.json?.data?.tokens?.accessToken;
      if (refreshOk) {
        studentAToken = refreshRes.json.data.tokens.accessToken;
      }
      recordTest(
        4,
        'Rotate refresh token POST /auth/refresh',
        200,
        refreshRes.status,
        refreshOk ? 'PASS' : 'FAIL',
        'Acquired rotated token set',
        'AuthController_refreshToken',
        true,
      );
    }

    // Change password request on synthetic student
    const changePwdRes = await request('POST', '/api/v1/auth/change-password', {
      token: studentAToken,
      body: { currentPassword: ACTOR_PASSWORD, newPassword: `${ACTOR_PASSWORD}#new` },
    });
    recordTest(
      4,
      'Change password POST /auth/change-password',
      200,
      changePwdRes.status,
      changePwdRes.status === 200 ? 'PASS' : 'FAIL',
      'Password changed on synthetic student',
      'AuthController_changePassword',
      true,
    );

    // Change email request on synthetic student (does not mutate demo accounts!)
    const changeEmailReq = await request('POST', '/api/v1/auth/change-email/request', {
      token: studentAToken,
      body: { newEmail: `student-a-new-${RUN_ID}@example.com`, password: `${ACTOR_PASSWORD}#new` },
    });
    recordTest(
      4,
      'Request change email POST /auth/change-email/request',
      200,
      changeEmailReq.status,
      changeEmailReq.status === 200 ? 'PASS' : 'FAIL',
      'Change email request issued for synthetic account',
      'AuthController_requestChangeEmail',
      true,
    );

    // Confirm change email with bad token -> 400
    const confirmEmailBad = await request('POST', '/api/v1/auth/change-email/confirm', {
      body: { token: 'invalid-change-email-token-garbage' },
    });
    recordTest(
      4,
      'Confirm change email with invalid token returns 400',
      400,
      confirmEmailBad.status,
      confirmEmailBad.status === 400 ? 'PASS' : 'FAIL',
      'Clean validation rejection',
      'AuthController_confirmChangeEmail',
      true,
    );

    // Student audit log GET /auth/audit-log
    const studentAudit = await request('GET', '/api/v1/auth/audit-log', { token: studentAToken });
    recordTest(
      4,
      'Student views own audit log GET /auth/audit-log',
      200,
      studentAudit.status,
      studentAudit.status === 200 && Array.isArray(studentAudit.json?.data) ? 'PASS' : 'FAIL',
      `Audit entries: ${studentAudit.json?.data?.length}`,
      'AuthController_auditLog',
      true,
    );

    // -----------------------------------------------------------------
    // PHASE 5 — STUDENTS & OWNERSHIP SCOPING
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 5: STUDENTS & OWNERSHIP SCOPING ---`);

    // Student A reads own profile via /students/me
    const studentAMe = await request('GET', '/api/v1/students/me', { token: studentAToken });
    recordTest(
      5,
      'Student reads own profile GET /students/me',
      200,
      studentAMe.status,
      studentAMe.status === 200 && studentAMe.json?.data?.id === studentAProfileId ? 'PASS' : 'FAIL',
      `Profile ID verified: ${studentAProfileId}`,
      'StudentsController_me',
      true,
    );

    // Student A edits own contact fields via PATCH /students/me (strictly mutates synthetic student!)
    const editSelf = await request('PATCH', '/api/v1/students/me', {
      token: studentAToken,
      body: { phone: '+84903333333', address: '789 Updated UAT Street' },
    });
    recordTest(
      5,
      'Student edits own allowed contact fields PATCH /students/me',
      200,
      editSelf.status,
      editSelf.status === 200 && editSelf.json?.data?.phone === '+84903333333' ? 'PASS' : 'FAIL',
      'Synthetic student profile updated',
      'StudentsController_updateOwn',
      true,
    );

    // Student A attempting to access Student B profile -> 404 uniform anti-probing
    const idorStudent = await request('GET', `/api/v1/students/${studentBProfileId}`, {
      token: studentAToken,
    });
    recordTest(
      5,
      'Foreign student profile probe answers uniform 404 (IDOR guard)',
      404,
      idorStudent.status,
      idorStudent.status === 404 ? 'PASS' : 'FAIL',
      'Ownership guard 7.3 uniform 404 enforced',
    );

    // Admin lists students
    const listStudents = await request('GET', '/api/v1/students?limit=10', { token: adminToken });
    recordTest(
      5,
      'Admin lists students GET /students',
      200,
      listStudents.status,
      listStudents.status === 200 && Array.isArray(listStudents.json?.data?.items) ? 'PASS' : 'FAIL',
      `Total items: ${listStudents.json?.data?.total}`,
      'StudentsController_list',
      true,
    );

    // Admin updates synthetic Student A
    const adminUpdateStu = await request('PATCH', `/api/v1/students/${studentAProfileId}`, {
      token: adminToken,
      body: { medicalNotes: 'No allergies recorded during UAT pass' },
    });
    recordTest(
      5,
      'Admin updates student PATCH /students/:id',
      200,
      adminUpdateStu.status,
      adminUpdateStu.status === 200 ? 'PASS' : 'FAIL',
      'Medical notes updated',
      'StudentsController_update',
      true,
    );

    // Admin regenerates invite code for child student profile
    const regenCode = await request('POST', `/api/v1/students/${childStudentProfileId}/invite-code`, {
      token: adminToken,
    });
    const inviteCode = regenCode.json?.data?.inviteCode;
    recordTest(
      5,
      'Admin regenerates invite code POST /students/:id/invite-code',
      200,
      regenCode.status,
      regenCode.status === 200 && !!inviteCode ? 'PASS' : 'FAIL',
      'Single-use invite code generated',
      'StudentsController_regenerateInviteCode',
      true,
    );

    // -----------------------------------------------------------------
    // PHASE 6 — PARENTS & PROXY ACCESS
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 6: PARENTS & PROXY ACCESS ---`);

    // Parent links to child using invite code
    if (inviteCode) {
      const linkChild = await request('POST', '/api/v1/parents/link', {
        token: parentToken,
        body: { inviteCode },
      });
      recordTest(
        6,
        'Parent links child using invite code POST /parents/link',
        201,
        linkChild.status,
        linkChild.status === 201 ? 'PASS' : 'FAIL',
        'Verified link created for synthetic child',
        'ParentsController_linkChild',
        true,
      );
    }

    // Parent views linked children
    const myChildren = await request('GET', '/api/v1/parents/children', { token: parentToken });
    recordTest(
      6,
      'Parent views linked children GET /parents/children',
      200,
      myChildren.status,
      myChildren.status === 200 && Array.isArray(myChildren.json?.data) ? 'PASS' : 'FAIL',
      `Children count: ${myChildren.json?.data?.length}`,
      'ParentsController_myChildren',
      true,
    );

    // Parent attempting to read unlinked Student A -> 404
    const parentUnlinked = await request('GET', `/api/v1/students/${studentAProfileId}`, {
      token: parentToken,
    });
    recordTest(
      6,
      'Parent unlinked student access answers uniform 404',
      404,
      parentUnlinked.status,
      parentUnlinked.status === 404 ? 'PASS' : 'FAIL',
      'Parent ownership scoping enforced',
    );

    // -----------------------------------------------------------------
    // PHASE 7 — CLASSES, SCHEDULES & ENROLLMENT
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 7: CLASSES, SCHEDULES & ENROLLMENT ---`);

    // List classes
    const listClasses = await request('GET', '/api/v1/classes', { token: instructorAToken });
    recordTest(
      7,
      'Instructor lists classes GET /classes',
      200,
      listClasses.status,
      listClasses.status === 200 && Array.isArray(listClasses.json?.data) ? 'PASS' : 'FAIL',
      `Classes count: ${listClasses.json?.data?.length}`,
      'ClassesController_list',
      true,
    );

    // Get Class A by ID
    const getCls = await request('GET', `/api/v1/classes/${classAId}`, { token: studentAToken });
    recordTest(
      7,
      'Get class details GET /classes/:id',
      200,
      getCls.status,
      getCls.status === 200 && getCls.json?.data?.id === classAId ? 'PASS' : 'FAIL',
      'Class details retrieved',
      'ClassesController_getById',
      true,
    );

    // Admin updates Class A
    const updateCls = await request('PATCH', `/api/v1/classes/${classAId}`, {
      token: adminToken,
      body: { capacity: 30 },
    });
    recordTest(
      7,
      'Admin updates class PATCH /classes/:id',
      200,
      updateCls.status,
      updateCls.status === 200 ? 'PASS' : 'FAIL',
      'Class capacity updated to 30',
      'ClassesController_update',
      true,
    );

    // List enrollments for Class A
    const listEnr = await request('GET', `/api/v1/classes/${classAId}/enrollments`, {
      token: instructorAToken,
    });
    recordTest(
      7,
      'List class enrollments GET /classes/:id/enrollments',
      200,
      listEnr.status,
      listEnr.status === 200 && Array.isArray(listEnr.json?.data) ? 'PASS' : 'FAIL',
      `Enrollments: ${listEnr.json?.data?.length}`,
      'EnrollmentsController_list',
      true,
    );

    // -----------------------------------------------------------------
    // PHASE 8 — ATTENDANCE
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 8: ATTENDANCE ---`);

    const sessionDate = new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10);

    // Instructor A creates attendance session for Class A
    const createSession = await request('POST', '/api/v1/attendance-sessions', {
      token: instructorAToken,
      body: { classId: classAId, sessionDate, topic: 'Basic Stances & Strikes' },
    });
    attendanceSessionAId = createSession.json?.data?.id;
    if (attendanceSessionAId) {
      registerCreatedResource('attendanceSessions', attendanceSessionAId);
    }
    recordTest(
      8,
      'Instructor creates attendance session POST /attendance-sessions',
      201,
      createSession.status,
      createSession.status === 201 && !!attendanceSessionAId ? 'PASS' : 'FAIL',
      `Session ID: ${attendanceSessionAId}`,
      'AttendanceController_createSession',
      true,
    );

    // Instructor B (foreign instructor) cannot create session for Class A -> 404
    const foreignAtt = await request('POST', '/api/v1/attendance-sessions', {
      token: instructorBToken,
      body: { classId: classAId, sessionDate: '2026-10-01' },
    });
    recordTest(
      8,
      'Foreign instructor creating attendance session returns uniform 404',
      404,
      foreignAtt.status,
      foreignAtt.status === 404 ? 'PASS' : 'FAIL',
      'Instructor class-scoping enforced',
    );

    // Bulk upsert records for synthetic Student A in session A
    if (attendanceSessionAId) {
      const upsertRec = await request(
        'POST',
        `/api/v1/attendance-sessions/${attendanceSessionAId}/records`,
        {
          token: instructorAToken,
          body: {
            records: [{ studentId: studentAProfileId, status: 'PRESENT', note: 'UAT verified' }],
          },
        },
      );
      recordTest(
        8,
        'Bulk upsert attendance records POST /attendance-sessions/:id/records',
        200,
        upsertRec.status,
        upsertRec.status === 200 ? 'PASS' : 'FAIL',
        'Upserted record for synthetic student',
        'AttendanceController_upsertRecords',
        true,
      );

      const listRecs = await request(
        'GET',
        `/api/v1/attendance-sessions/${attendanceSessionAId}/records`,
        {
          token: instructorAToken,
        },
      );
      recordTest(
        8,
        'List attendance records GET /attendance-sessions/:id/records',
        200,
        listRecs.status,
        listRecs.status === 200 ? 'PASS' : 'FAIL',
        `Records count: ${listRecs.json?.data?.length}`,
        'AttendanceController_listRecords',
        true,
      );
    } else {
      // If session creation failed, DO NOT pretend it was covered!
      recordTest(
        8,
        'Attendance records upsert skipped (session creation failed)',
        200,
        0,
        'BLOCKED',
        'Attendance session could not be created; skipping records test',
        'AttendanceController_upsertRecords',
        false,
      );
      recordTest(
        8,
        'Attendance records listing skipped (session creation failed)',
        200,
        0,
        'BLOCKED',
        'Attendance session could not be created; skipping records list',
        'AttendanceController_listRecords',
        false,
      );
    }

    // Student attendance history
    const stuAttHistory = await request(
      'GET',
      `/api/v1/students/${studentAProfileId}/attendance`,
      {
        token: studentAToken,
      },
    );
    recordTest(
      8,
      'Student attendance history GET /students/:id/attendance',
      200,
      stuAttHistory.status,
      stuAttHistory.status === 200 && Array.isArray(stuAttHistory.json?.data?.items) ? 'PASS' : 'FAIL',
      `History records: ${stuAttHistory.json?.data?.items?.length}`,
      'AttendanceController_history',
      true,
    );

    // Attendance summary
    const attSummary = await request(
      'GET',
      `/api/v1/attendance/summary?studentId=${studentAProfileId}&month=2026-10`,
      {
        token: studentAToken,
      },
    );
    recordTest(
      8,
      'Attendance summary GET /attendance/summary',
      200,
      attSummary.status,
      attSummary.status === 200 ? 'PASS' : 'FAIL',
      'Attendance summary retrieved',
      'AttendanceController_summary',
      true,
    );

    // Monthly attendance report (Admin)
    const attMonthly = await request('GET', `/api/v1/admin/reports/attendance?month=2026-10`, {
      token: adminToken,
    });
    recordTest(
      8,
      'Attendance monthly report GET /admin/reports/attendance',
      200,
      attMonthly.status,
      attMonthly.status === 200 && Array.isArray(attMonthly.json?.data) ? 'PASS' : 'FAIL',
      `Classes reported: ${attMonthly.json?.data?.length}`,
      'AttendanceController_monthlyReport',
      true,
    );

    // -----------------------------------------------------------------
    // PHASE 9 — BELTS & EXAMS
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 9: BELTS & EXAMS ---`);

    // Belt ranks list
    const beltRanks = await request('GET', '/api/v1/belt-ranks', { token: studentAToken });
    recordTest(
      9,
      'Belt ranks catalog GET /belt-ranks',
      200,
      beltRanks.status,
      beltRanks.status === 200 && Array.isArray(beltRanks.json?.data) ? 'PASS' : 'FAIL',
      `Ranks catalog: ${beltRanks.json?.data?.length} ranks`,
      'BeltsController_list',
      true,
    );

    // Belt distribution report (Admin)
    const beltDist = await request('GET', '/api/v1/admin/reports/belts', { token: adminToken });
    recordTest(
      9,
      'Belt distribution report GET /admin/reports/belts',
      200,
      beltDist.status,
      beltDist.status === 200 && Array.isArray(beltDist.json?.data) ? 'PASS' : 'FAIL',
      'Belt distribution report generated',
      'BeltReportsController_distribution',
      true,
    );

    // Admin creates synthetic belt rank
    const uniqueOrder = Math.floor(10000 + Math.random() * 80000);
    const newRankCode = `T_${RUN_ID.slice(0, 4)}_${uniqueOrder % 1000}`;
    const createRank = await request('POST', '/api/v1/belt-ranks', {
      token: adminToken,
      body: { code: newRankCode, name: `Test Rank ${newRankCode}`, rankGroup: 'LAM', orderIndex: uniqueOrder },
    });
    testBeltRankId = createRank.json?.data?.id;
    if (testBeltRankId) {
      registerCreatedResource('beltRanks', String(testBeltRankId));
    }
    recordTest(
      9,
      'Admin creates synthetic belt rank POST /belt-ranks',
      201,
      createRank.status,
      createRank.status === 201 && !!testBeltRankId ? 'PASS' : 'FAIL',
      `Rank ID: ${testBeltRankId}`,
      'BeltsController_create',
      true,
    );

    // Admin updates ONLY the newly created synthetic belt rank (NEVER fallback to catalog rank 1!)
    if (testBeltRankId) {
      const updateRank = await request('PATCH', `/api/v1/belt-ranks/${testBeltRankId}`, {
        token: adminToken,
        body: { name: `Test Rank Updated ${newRankCode}` },
      });
      recordTest(
        9,
        'Admin updates synthetic belt rank PATCH /belt-ranks/:id',
        200,
        updateRank.status,
        updateRank.status === 200 ? 'PASS' : 'FAIL',
        'Updated synthetic rank name',
        'BeltsController_update',
        true,
      );
    }

    // Admin creates belt exam
    const examDate = new Date(Date.now() + 86400000 * 14).toISOString().slice(0, 10);
    const regClose = new Date(Date.now() + 86400000 * 7).toISOString();
    const createExam = await request('POST', '/api/v1/belt-exams', {
      token: adminToken,
      body: {
        title: `UAT Exam ${RUN_ID.slice(0, 6)}`,
        examDate,
        registrationClosesAt: regClose,
        feeAmount: 150000,
      },
    });
    examAId = createExam.json?.data?.id;
    if (examAId) {
      registerCreatedResource('exams', examAId);
    }
    recordTest(
      9,
      'Admin creates belt exam POST /belt-exams',
      201,
      createExam.status,
      createExam.status === 201 && !!examAId ? 'PASS' : 'FAIL',
      `Exam ID: ${examAId}`,
      'ExamsController_create',
      true,
    );

    // List belt exams
    const listExams = await request('GET', '/api/v1/belt-exams', { token: studentAToken });
    recordTest(
      9,
      'List belt exams GET /belt-exams',
      200,
      listExams.status,
      listExams.status === 200 && Array.isArray(listExams.json?.data) ? 'PASS' : 'FAIL',
      `Exams count: ${listExams.json?.data?.length}`,
      'ExamsController_list',
      true,
    );

    // Get exam by ID
    if (examAId) {
      const getExam = await request('GET', `/api/v1/belt-exams/${examAId}`, { token: studentAToken });
      recordTest(
        9,
        'Get exam details GET /belt-exams/:id',
        200,
        getExam.status,
        getExam.status === 200 && getExam.json?.data?.id === examAId ? 'PASS' : 'FAIL',
        'Exam details retrieved',
        'ExamsController_getById',
        true,
      );

      // Admin updates exam
      const updateExam = await request('PATCH', `/api/v1/belt-exams/${examAId}`, {
        token: adminToken,
        body: { title: `UAT Exam Updated ${RUN_ID.slice(0, 6)}` },
      });
      recordTest(
        9,
        'Admin updates exam PATCH /belt-exams/:id',
        200,
        updateExam.status,
        updateExam.status === 200 ? 'PASS' : 'FAIL',
        'Exam title updated',
        'ExamsController_update',
        true,
      );

      // Student A registers for exam (strictly targets synthetic Student A!)
      const registerExam = await request('POST', `/api/v1/belt-exams/${examAId}/register`, {
        token: studentAToken,
        body: { studentId: studentAProfileId },
      });
      examRegistrationAId = registerExam.json?.data?.id;
      if (examRegistrationAId) {
        registerCreatedResource('registrations', examRegistrationAId);
        // Note: exam registration atomically creates an exam fee invoice
        const examInvId = registerExam.json?.data?.invoice?.id;
        if (examInvId) {
          registerCreatedResource('invoices', examInvId);
          syntheticFinancialResidue.invoices.push(examInvId);
        }
      }
      recordTest(
        9,
        'Student registers for exam POST /belt-exams/:id/register',
        201,
        registerExam.status,
        registerExam.status === 201 && !!examRegistrationAId ? 'PASS' : 'FAIL',
        `Registration ID: ${examRegistrationAId}`,
        'ExamsController_register',
        true,
      );

      // List student registrations
      const listRegs = await request(
        'GET',
        `/api/v1/exam-registrations?studentId=${studentAProfileId}`,
        {
          token: studentAToken,
        },
      );
      recordTest(
        9,
        'List student exam registrations GET /exam-registrations',
        200,
        listRegs.status,
        listRegs.status === 200 && Array.isArray(listRegs.json?.data) ? 'PASS' : 'FAIL',
        `Registrations: ${listRegs.json?.data?.length}`,
        'ExamsController_listStudentRegistrations',
        true,
      );

      // Instructor records exam result (PASS promotes synthetic student A)
      if (examRegistrationAId && testBeltRankId) {
        const recordResult = await request(
          'POST',
          `/api/v1/exam-registrations/${examRegistrationAId}/result`,
          {
            token: instructorAToken,
            body: { status: 'RESULT_PASS', newBeltRankId: testBeltRankId, score: 8.5 },
          },
        );
        recordTest(
          9,
          'Instructor records exam result PASS POST /exam-registrations/:id/result',
          200,
          recordResult.status,
          recordResult.status === 200 ? 'PASS' : 'FAIL',
          'Promoted synthetic student A',
          'ExamsController_recordResult',
          true,
        );
      }
    }

    // -----------------------------------------------------------------
    // PHASE 10 — BILLING & FINANCIAL SAFETY (F4 & F5)
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 10: BILLING & FINANCIAL SAFETY ---`);

    // GET billing settings (Read-only verification; safe on live)
    const billSettings = await request('GET', '/api/v1/admin/billing/settings', {
      token: adminToken,
    });
    recordTest(
      10,
      'Get billing settings GET /admin/billing/settings',
      200,
      billSettings.status,
      billSettings.status === 200 ? 'PASS' : 'FAIL',
      'Billing settings retrieved read-only',
      'BillingController_getSettings',
      true,
    );

    // MUTATING GLOBAL SETTINGS IS STRICTLY FORBIDDEN ON LIVE (F4)
    recordTest(
      10,
      'PUT /admin/billing/settings/tuition-rates mutation skipped on live',
      'Protected global state preserved',
      'Skipped for live safety',
      'NOT_SAFE_TO_AUTOMATE',
      'Global tuition rates must not be mutated on live Render deployment per Phase 4 contract.',
      'BillingController_updateTuitionRates',
      false,
    );

    recordTest(
      10,
      'PUT /admin/billing/settings/bank-account mutation skipped on live',
      'Protected global state preserved',
      'Skipped for live safety',
      'NOT_SAFE_TO_AUTOMATE',
      'Global bank account settings must not be mutated on live Render deployment per Phase 4 contract.',
      'BillingController_updateBankAccount',
      false,
    );

    // Create synthetic discount code
    const discountCodeName = `UAT${RUN_ID.slice(0, 4).toUpperCase()}`;
    const createDiscount = await request('POST', '/api/v1/discounts', {
      token: adminToken,
      body: {
        code: discountCodeName,
        discountType: 'FIXED',
        amount: 25000,
        validUntil: new Date(Date.now() + 86400000 * 30).toISOString(),
      },
    });
    manualDiscountId = createDiscount.json?.data?.id;
    if (manualDiscountId) {
      registerCreatedResource('discounts', manualDiscountId);
    }
    recordTest(
      10,
      'Admin creates discount code POST /discounts',
      201,
      createDiscount.status,
      createDiscount.status === 201 && !!manualDiscountId ? 'PASS' : 'FAIL',
      `Discount Code: ${discountCodeName}`,
      'BillingController_createDiscount',
      true,
    );

    // List discounts
    const listDiscounts = await request('GET', '/api/v1/discounts', { token: adminToken });
    recordTest(
      10,
      'List discounts GET /discounts',
      200,
      listDiscounts.status,
      listDiscounts.status === 200 && Array.isArray(listDiscounts.json?.data) ? 'PASS' : 'FAIL',
      `Discounts count: ${listDiscounts.json?.data?.length}`,
      'BillingController_listDiscounts',
      true,
    );

    // Update discount
    if (manualDiscountId) {
      const updateDisc = await request('PATCH', `/api/v1/discounts/${manualDiscountId}`, {
        token: adminToken,
        body: { amount: 30000 },
      });
      recordTest(
        10,
        'Admin updates discount PATCH /discounts/:id',
        200,
        updateDisc.status,
        updateDisc.status === 200 ? 'PASS' : 'FAIL',
        'Discount amount updated to 30,000 VND',
        'BillingController_updateDiscount',
        true,
      );
    }

    // Admin creates manual invoice for synthetic Student A (F5 safe)
    const createInv = await request('POST', '/api/v1/invoices', {
      token: adminToken,
      body: {
        studentId: studentAProfileId,
        type: 'OTHER',
        items: [{ description: 'Vovinam Uniform Size 4', quantity: 1, unitAmount: 350000 }],
        discountCode: discountCodeName,
        note: `UAT manual invoice ${RUN_ID}`,
      },
    });
    manualInvoiceId = createInv.json?.data?.id;
    if (manualInvoiceId) {
      registerCreatedResource('invoices', manualInvoiceId);
      syntheticFinancialResidue.invoices.push(manualInvoiceId);
    }
    recordTest(
      10,
      'Admin creates invoice for synthetic student POST /invoices',
      201,
      createInv.status,
      createInv.status === 201 && !!manualInvoiceId ? 'PASS' : 'FAIL',
      `Invoice ID: ${manualInvoiceId}`,
      'BillingController_create',
      true,
    );

    // List invoices
    const listInv = await request('GET', '/api/v1/invoices', { token: adminToken });
    recordTest(
      10,
      'List invoices GET /invoices',
      200,
      listInv.status,
      listInv.status === 200 && Array.isArray(listInv.json?.data?.items) ? 'PASS' : 'FAIL',
      `Invoices count: ${listInv.json?.data?.total}`,
      'BillingController_list',
      true,
    );

    // Get invoice by ID
    if (manualInvoiceId) {
      const getInv = await request('GET', `/api/v1/invoices/${manualInvoiceId}`, {
        token: studentAToken,
      });
      recordTest(
        10,
        'Get invoice details GET /invoices/:id',
        200,
        getInv.status,
        getInv.status === 200 && getInv.json?.data?.id === manualInvoiceId ? 'PASS' : 'FAIL',
        'Invoice retrieved',
        'BillingController_getById',
        true,
      );
    }

    // Generate monthly tuition for ONLY synthetic Class A (no pre-existing enrollments touched)
    const genMonthly = await request('POST', '/api/v1/admin/billing/generate-monthly', {
      token: adminToken,
      body: { month: 11, year: 2026, classIds: [classAId] },
    });
    recordTest(
      10,
      'Generate monthly tuition scoped to synthetic class POST /admin/billing/generate-monthly',
      200,
      genMonthly.status,
      genMonthly.status === 200 ? 'PASS' : 'FAIL',
      `Generated: ${genMonthly.json?.data?.generated ?? 0}, Skipped: ${genMonthly.json?.data?.skippedExisting ?? 0}`,
      'BillingController_generateMonthly',
      true,
    );

    // Billing reports
    const revReport = await request('GET', '/api/v1/admin/reports/revenue?from=2026-09-01&to=2026-10-31', {
      token: adminToken,
    });
    recordTest(
      10,
      'Revenue report GET /admin/reports/revenue',
      200,
      revReport.status,
      revReport.status === 200 ? 'PASS' : 'FAIL',
      'Revenue report retrieved',
      'BillingController_revenue',
      true,
    );

    const tuiReport = await request('GET', '/api/v1/admin/reports/tuition?month=10&year=2026', {
      token: adminToken,
    });
    recordTest(
      10,
      'Tuition report GET /admin/reports/tuition',
      200,
      tuiReport.status,
      tuiReport.status === 200 ? 'PASS' : 'FAIL',
      'Tuition report retrieved',
      'BillingController_tuitionReport',
      true,
    );

    // -----------------------------------------------------------------
    // PHASE 11 — PAYMENTS (SIMULATED GATEWAY POSTURE)
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 11: PAYMENTS (SIMULATED POSTURE) ---`);

    // Create QR payment for synthetic invoice
    let paymentTxnId = '';
    if (manualInvoiceId) {
      const qrRes = await request('POST', `/api/v1/payments/qr/${manualInvoiceId}`, {
        token: studentAToken,
      });
      const orderRef = qrRes.json?.data?.orderRef;
      recordTest(
        11,
        'Create QR payment POST /payments/qr/:invoiceId',
        201,
        qrRes.status,
        qrRes.status === 201 && !!orderRef ? 'PASS' : 'FAIL',
        `Order Ref: ${orderRef}`,
        'PaymentsController_createQrPayment',
        true,
      );

      // Confirm cash payment (Admin confirms payment on synthetic invoice)
      const cashRes = await request('POST', `/api/v1/payments/${manualInvoiceId}/confirm-cash`, {
        token: adminToken,
        body: { note: 'UAT cash confirmation' },
      });
      paymentTxnId = cashRes.json?.data?.payment?.id;
      if (paymentTxnId) {
        registerCreatedResource('payments', paymentTxnId);
        syntheticFinancialResidue.payments.push(paymentTxnId);
      }
      recordTest(
        11,
        'Confirm cash payment POST /payments/:invoiceId/confirm-cash',
        200,
        cashRes.status,
        cashRes.status === 200 && !!paymentTxnId ? 'PASS' : 'FAIL',
        `Payment Transaction ID: ${paymentTxnId}`,
        'PaymentsController_confirmCash',
        true,
      );

      // Duplicate payment attempt rejected (409)
      const dupCash = await request('POST', `/api/v1/payments/${manualInvoiceId}/confirm-cash`, {
        token: adminToken,
        body: { note: 'Duplicate cash attempt' },
      });
      recordTest(
        11,
        'Duplicate cash confirmation rejected 409',
        409,
        dupCash.status,
        dupCash.status === 409 ? 'PASS' : 'FAIL',
        'Invoice already paid rejection verified',
      );

      // List payments for invoice
      const listPayments = await request('GET', `/api/v1/payments?invoiceId=${manualInvoiceId}`, {
        token: studentAToken,
      });
      recordTest(
        11,
        'List payments for invoice GET /payments?invoiceId=:id',
        200,
        listPayments.status,
        listPayments.status === 200 && Array.isArray(listPayments.json?.data) ? 'PASS' : 'FAIL',
        `Payments found: ${listPayments.json?.data?.length}`,
        'PaymentsController_listForInvoice',
        true,
      );

      // Set outcome / Refund payment (Admin refunds the synthetic transaction)
      if (paymentTxnId) {
        const refundRes = await request('PATCH', `/api/v1/payments/${paymentTxnId}`, {
          token: adminToken,
          body: { status: 'REFUNDED', note: 'UAT payment refund verification' },
        });
        recordTest(
          11,
          'Refund payment transaction PATCH /payments/:id',
          200,
          refundRes.status,
          refundRes.status === 200 ? 'PASS' : 'FAIL',
          'Transaction status set to REFUNDED',
          'PaymentsController_setOutcome',
          true,
        );
      }
    }

    // Real payment provider webhook callback: classified BLOCKED per Phase 5 & 12
    recordTest(
      11,
      'Real payment gateway provider webhook callback',
      'External provider HMAC webhook',
      'Simulated gateway active',
      'BLOCKED',
      'Render integration environment runs PAYMENTS_GATEWAY=simulated. External provider callbacks intentionally not triggered on live to protect real funds.',
      'PaymentsController_webhook',
      false,
    );

    // -----------------------------------------------------------------
    // PHASE 12 — ANNOUNCEMENTS
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 12: ANNOUNCEMENTS ---`);

    // Instructor A creates class-scoped announcement for Class A
    const createAnn = await request('POST', '/api/v1/announcements', {
      token: instructorAToken,
      body: {
        title: `UAT Announcement ${RUN_ID.slice(0, 6)}`,
        content: 'Please arrive 10 minutes early for warmups.',
        targetAudience: 'CLASS',
        classId: classAId,
      },
    });
    announcementId = createAnn.json?.data?.id;
    if (announcementId) {
      registerCreatedResource('announcements', announcementId);
    }
    recordTest(
      12,
      'Instructor creates announcement POST /announcements',
      201,
      createAnn.status,
      createAnn.status === 201 && !!announcementId ? 'PASS' : 'FAIL',
      `Announcement ID: ${announcementId}`,
      'AnnouncementsController_create',
      true,
    );

    // List announcements
    const listAnn = await request('GET', '/api/v1/announcements', { token: studentAToken });
    recordTest(
      12,
      'List announcements GET /announcements',
      200,
      listAnn.status,
      listAnn.status === 200 && Array.isArray(listAnn.json?.data) ? 'PASS' : 'FAIL',
      `Announcements count: ${listAnn.json?.data?.length}`,
      'AnnouncementsController_list',
      true,
    );

    // Update announcement
    if (announcementId) {
      const updateAnn = await request('PATCH', `/api/v1/announcements/${announcementId}`, {
        token: instructorAToken,
        body: { title: `UAT Announcement Updated ${RUN_ID.slice(0, 6)}` },
      });
      recordTest(
        12,
        'Instructor updates announcement PATCH /announcements/:id',
        200,
        updateAnn.status,
        updateAnn.status === 200 ? 'PASS' : 'FAIL',
        'Announcement updated',
        'AnnouncementsController_update',
        true,
      );
    }

    // -----------------------------------------------------------------
    // PHASE 13 — LEAVE REQUESTS
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 13: LEAVE REQUESTS ---`);

    const leaveDate = new Date(Date.now() + 86400000 * 5).toISOString().slice(0, 10);

    // Student A submits leave request for Class A
    const createLeave = await request('POST', '/api/v1/leave-requests', {
      token: studentAToken,
      body: {
        studentId: studentAProfileId,
        classId: classAId,
        startDate: leaveDate,
        endDate: leaveDate,
        reason: 'School exam conflict',
      },
    });
    leaveRequestId = createLeave.json?.data?.id;
    if (leaveRequestId) {
      registerCreatedResource('leaves', leaveRequestId);
    }
    recordTest(
      13,
      'Student submits leave request POST /leave-requests',
      201,
      createLeave.status,
      createLeave.status === 201 && !!leaveRequestId ? 'PASS' : 'FAIL',
      `Leave Request ID: ${leaveRequestId}`,
      'LeavesController_create',
      true,
    );

    // List leave requests
    const listLeaves = await request('GET', '/api/v1/leave-requests', { token: instructorAToken });
    recordTest(
      13,
      'Instructor lists leave requests GET /leave-requests',
      200,
      listLeaves.status,
      listLeaves.status === 200 && Array.isArray(listLeaves.json?.data) ? 'PASS' : 'FAIL',
      `Leave requests count: ${listLeaves.json?.data?.length}`,
      'LeavesController_list',
      true,
    );

    // Instructor A reviews leave request (APPROVED)
    if (leaveRequestId) {
      const reviewLeave = await request('POST', `/api/v1/leave-requests/${leaveRequestId}/review`, {
        token: instructorAToken,
        body: { status: 'APPROVED', comment: 'Approved for school exams' },
      });
      recordTest(
        13,
        'Instructor reviews leave request POST /leave-requests/:id/review',
        200,
        reviewLeave.status,
        reviewLeave.status === 200 ? 'PASS' : 'FAIL',
        'Leave request APPROVED',
        'LeavesController_review',
        true,
      );

      // Student cancel endpoint (tested on a second synthetic leave)
      const leaveDate2 = new Date(Date.now() + 86400000 * 6).toISOString().slice(0, 10);
      const leave2 = await request('POST', '/api/v1/leave-requests', {
        token: studentAToken,
        body: {
          studentId: studentAProfileId,
          classId: classAId,
          startDate: leaveDate2,
          endDate: leaveDate2,
          reason: 'Family event',
        },
      });
      const leave2Id = leave2.json?.data?.id;
      if (leave2Id) {
        registerCreatedResource('leaves', leave2Id);
        const cancelLeave = await request('POST', `/api/v1/leave-requests/${leave2Id}/cancel`, {
          token: studentAToken,
        });
        recordTest(
          13,
          'Student cancels own leave request POST /leave-requests/:id/cancel',
          200,
          cancelLeave.status,
          cancelLeave.status === 200 ? 'PASS' : 'FAIL',
          'Leave request cancelled',
          'LeavesController_cancel',
          true,
        );
      }
    }

    // -----------------------------------------------------------------
    // PHASE 14 — PROMOTION PROPOSALS
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 14: PROMOTION PROPOSALS ---`);

    // Instructor A creates promotion proposal for Student A
    const createProp = await request('POST', '/api/v1/promotion-proposals', {
      token: instructorAToken,
      body: {
        studentId: studentAProfileId,
        targetBeltRankId: testBeltRankId || 2,
        reason: 'Excellent training attendance and technique progress',
      },
    });
    promotionProposalId = createProp.json?.data?.id;
    if (promotionProposalId) {
      registerCreatedResource('proposals', promotionProposalId);
    }
    recordTest(
      14,
      'Instructor creates promotion proposal POST /promotion-proposals',
      201,
      createProp.status,
      createProp.status === 201 && !!promotionProposalId ? 'PASS' : 'FAIL',
      `Proposal ID: ${promotionProposalId}`,
      'PromotionsController_create',
      true,
    );

    // List promotion proposals
    const listProps = await request('GET', '/api/v1/promotion-proposals', { token: adminToken });
    recordTest(
      14,
      'List promotion proposals GET /promotion-proposals',
      200,
      listProps.status,
      listProps.status === 200 && Array.isArray(listProps.json?.data) ? 'PASS' : 'FAIL',
      `Proposals count: ${listProps.json?.data?.length}`,
      'PromotionsController_list',
      true,
    );

    // Update proposal note
    if (promotionProposalId) {
      const updatePropNote = await request(
        'PATCH',
        `/api/v1/promotion-proposals/${promotionProposalId}`,
        {
          token: instructorAToken,
          body: { reason: 'Updated note: candidate ready for upcoming promotion examination' },
        },
      );
      recordTest(
        14,
        'Instructor updates proposal note PATCH /promotion-proposals/:id',
        200,
        updatePropNote.status,
        updatePropNote.status === 200 ? 'PASS' : 'FAIL',
        'Proposal note updated',
        'PromotionsController_updateNote',
        true,
      );

      // Admin reviews proposal (advisory approval)
      const reviewProp = await request(
        'POST',
        `/api/v1/promotion-proposals/${promotionProposalId}/review`,
        {
          token: adminToken,
          body: { status: 'APPROVED', reviewComment: 'Approved for exam registration' },
        },
      );
      recordTest(
        14,
        'Admin reviews proposal POST /promotion-proposals/:id/review',
        200,
        reviewProp.status,
        reviewProp.status === 200 ? 'PASS' : 'FAIL',
        'Proposal reviewed as APPROVED',
        'PromotionsController_review',
        true,
      );
    }

    // -----------------------------------------------------------------
    // PHASE 15 — EVALUATIONS (FINDING N3 CLASS AUTHORIZATION)
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 15: EVALUATIONS (N3 CLASS-SCOPING) ---`);

    // Finding N3: Instructor B attempting to evaluate Student A with Class A (which B does NOT teach) -> 404
    const foreignClassEval = await request('POST', '/api/v1/evaluations', {
      token: instructorBToken,
      body: {
        studentId: studentAProfileId,
        classId: classAId,
        periodMonth: 10,
        periodYear: 2026,
        rating: 8,
      },
    });
    recordTest(
      15,
      'Foreign instructor class evaluation rejected uniform 404 (finding N3)',
      404,
      foreignClassEval.status,
      foreignClassEval.status === 404 ? 'PASS' : 'FAIL',
      'Instructor class-scoped authorization verified (finding N3 resolved)',
    );

    // Instructor A evaluates Student A referencing Class A (taught by A) -> 201
    const createEval = await request('POST', '/api/v1/evaluations', {
      token: instructorAToken,
      body: {
        studentId: studentAProfileId,
        classId: classAId,
        periodMonth: 10,
        periodYear: 2026,
        rating: 9,
        comment: 'Outstanding dedication and technique progress',
      },
    });
    evaluationId = createEval.json?.data?.id;
    if (evaluationId) {
      registerCreatedResource('evaluations', evaluationId);
    }
    recordTest(
      15,
      'Instructor creates student evaluation for own class POST /evaluations',
      201,
      createEval.status,
      createEval.status === 201 && !!evaluationId ? 'PASS' : 'FAIL',
      `Evaluation ID: ${evaluationId}`,
      'EvaluationsController_create',
      true,
    );

    // List evaluations for student
    const listEvals = await request(
      'GET',
      `/api/v1/evaluations?studentId=${studentAProfileId}`,
      {
        token: studentAToken,
      },
    );
    recordTest(
      15,
      'Student reads own evaluations GET /evaluations?studentId=:id',
      200,
      listEvals.status,
      listEvals.status === 200 && Array.isArray(listEvals.json?.data?.items) ? 'PASS' : 'FAIL',
      `Evaluations found: ${listEvals.json?.data?.items?.length}`,
      'EvaluationsController_listForStudent',
      true,
    );

    // Update evaluation
    if (evaluationId) {
      const updateEval = await request('PATCH', `/api/v1/evaluations/${evaluationId}`, {
        token: instructorAToken,
        body: { rating: 10, comment: 'Exceptional form' },
      });
      recordTest(
        15,
        'Instructor updates evaluation PATCH /evaluations/:id',
        200,
        updateEval.status,
        updateEval.status === 200 ? 'PASS' : 'FAIL',
        'Evaluation updated',
        'EvaluationsController_update',
        true,
      );
    }

    // -----------------------------------------------------------------
    // PHASE 16 — NOTIFICATIONS & CONSENT
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 16: NOTIFICATIONS & CONSENT ---`);

    // Student feed
    const feed = await request('GET', '/api/v1/notifications/feed', { token: studentAToken });
    recordTest(
      16,
      'Student views notification feed GET /notifications/feed',
      200,
      feed.status,
      feed.status === 200 && Array.isArray(feed.json?.data) ? 'PASS' : 'FAIL',
      `Feed items: ${feed.json?.data?.length}`,
      'NotificationsController_feed',
      true,
    );

    // Mark notification read (if any in feed)
    if (feed.json?.data?.length > 0) {
      const notifId = feed.json.data[0].id;
      const markRead = await request('PATCH', `/api/v1/notifications/${notifId}/read`, {
        token: studentAToken,
      });
      recordTest(
        16,
        'Student marks notification read PATCH /notifications/:id/read',
        200,
        markRead.status,
        markRead.status === 200 ? 'PASS' : 'FAIL',
        'Notification marked read',
        'NotificationsController_markRead',
        true,
      );
    } else {
      recordTest(
        16,
        'Notification mark-read skipped (feed empty for newly created synthetic student)',
        200,
        0,
        'MANUAL_REQUIRED',
        'Synthetic student feed had 0 items; mark-read verified via unit/e2e tests',
        'NotificationsController_markRead',
        false,
      );
    }

    // Admin flushes outbox
    const flushOutbox = await request('POST', '/api/v1/notifications/outbox/flush', {
      token: adminToken,
    });
    recordTest(
      16,
      'Admin flushes notifications outbox POST /notifications/outbox/flush',
      200,
      flushOutbox.status,
      flushOutbox.status === 200 ? 'PASS' : 'FAIL',
      'Outbox flushed',
      'NotificationsController_flush',
      true,
    );

    // Student grants consent
    const grantConsent = await request('POST', '/api/v1/consent', {
      token: studentAToken,
      body: { purpose: 'MEDIA_PUBLICATION', granted: true },
    });
    recordTest(
      16,
      'Student grants consent POST /consent',
      200,
      grantConsent.status,
      grantConsent.status === 200 ? 'PASS' : 'FAIL',
      'MEDIA_PUBLICATION consent granted',
      'ConsentController_grant',
      true,
    );

    // View consent history
    const consentHist = await request('GET', '/api/v1/consent', { token: studentAToken });
    recordTest(
      16,
      'Student views consent history GET /consent',
      200,
      consentHist.status,
      consentHist.status === 200 && Array.isArray(consentHist.json?.data) ? 'PASS' : 'FAIL',
      `Consent records: ${consentHist.json?.data?.length}`,
      'ConsentController_history',
      true,
    );

    // Revoke consent
    const revokeConsent = await request('POST', '/api/v1/consent/revoke', {
      token: studentAToken,
      body: { purpose: 'MEDIA_PUBLICATION' },
    });
    recordTest(
      16,
      'Student revokes consent POST /consent/revoke',
      200,
      revokeConsent.status,
      revokeConsent.status === 200 ? 'PASS' : 'FAIL',
      'Consent revoked',
      'ConsentController_revoke',
      true,
    );

    // -----------------------------------------------------------------
    // PHASE 17 — USER MANAGEMENT & ADMIN AUDIT
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 17: USER MANAGEMENT & ADMIN AUDIT ---`);

    // Admin lists users
    const listUsers = await request('GET', '/api/v1/users', { token: adminToken });
    recordTest(
      17,
      'Admin lists users GET /users',
      200,
      listUsers.status,
      listUsers.status === 200 && Array.isArray(listUsers.json?.data?.items) ? 'PASS' : 'FAIL',
      `Total users: ${listUsers.json?.data?.total}`,
      'AdminUsersController_list',
      true,
    );

    // Admin updates synthetic user
    const updateUsr = await request('PATCH', `/api/v1/users/${studentBUserId}`, {
      token: adminToken,
      body: { role: 'STUDENT' },
    });
    recordTest(
      17,
      'Admin updates user PATCH /users/:id',
      200,
      updateUsr.status,
      updateUsr.status === 200 ? 'PASS' : 'FAIL',
      'Synthetic user updated',
      'AdminUsersController_update',
      true,
    );

    // Admin self-deactivation attempt rejected (400)
    const selfDeact = await request('DELETE', `/api/v1/users/${adminUserId}`, {
      token: adminToken,
    });
    recordTest(
      17,
      'Admin self-deactivation attempt cleanly rejected (400)',
      400,
      selfDeact.status,
      selfDeact.status === 400 ? 'PASS' : 'FAIL',
      'Self-deactivation prevented by business rules',
    );

    // Admin audit view GET /admin/audit-log
    const adminAudit = await request('GET', '/api/v1/admin/audit-log?limit=10', {
      token: adminToken,
    });
    recordTest(
      17,
      'Admin views central audit log GET /admin/audit-log',
      200,
      adminAudit.status,
      adminAudit.status === 200 && Array.isArray(adminAudit.json?.data?.items) ? 'PASS' : 'FAIL',
      `Audit items: ${adminAudit.json?.data?.items?.length}`,
      'AdminUsersController_auditLog',
      true,
    );

    // -----------------------------------------------------------------
    // PHASE 18 — RATE LIMITING & SECURITY POSTURE (F8)
    // -----------------------------------------------------------------
    console.log(`\n--- PHASE 18: RATE LIMITING & OPERATIONAL INTEGRITY ---`);

    // Safe sample: 8 requests on auth login (no production flood)
    const burstPromises = [];
    for (let i = 0; i < 8; i++) {
      burstPromises.push(
        request('POST', '/api/v1/auth/login', {
          body: { email: `probe-burst-${i}-${RUN_ID}@example.com`, password: 'WrongPassword#123' },
        }),
      );
    }
    const burstResults = await Promise.all(burstPromises);
    const burstStatuses = burstResults.map((r) => r.status);
    const rateLimitVerdict = evaluateRateLimitAssertion(burstStatuses);
    const seen429 = burstStatuses.includes(429);

    recordTest(
      18,
      'Auth rate-limiting probe (non-flooding safe sample)',
      seen429 ? 429 : '401 (sample within budget)',
      `Statuses: ${burstStatuses.slice(0, 4).join(', ')}...`,
      rateLimitVerdict,
      seen429
        ? '429 observed on live deployment'
        : `Safe 8-request sample within configured limit (30/min). Production flood withheld for safety. Live enforcement classified as ${rateLimitVerdict}.`,
    );

    // Verify server health post-burst
    const postBurstHealth = await request('GET', '/healthz');
    recordTest(
      18,
      'Server health verified post rate-limit probe',
      200,
      postBurstHealth.status,
      postBurstHealth.status === 200 ? 'PASS' : 'FAIL',
      'Healthz=200 post-probe',
    );

    // Scan results across all response bodies (Phase 10 / F9)
    recordTest(
      18,
      'Information leak scan across actual response bodies',
      '0 leaks',
      `${leakScanResults.leaks.length} leaks`,
      leakScanResults.leaks.length === 0 ? 'PASS' : 'FAIL',
      `Scanned ${leakScanResults.scannedCount} response bodies. Leaks detected: ${leakScanResults.leaks.length}`,
    );

    runStatus = 'RUN COMPLETED';
  } catch (err) {
    runStatus = 'RUN ABORTED';
    console.error('\n[FATAL ERROR DURING LIVE UAT]:', err.message);
  } finally {
    await performGuaranteedCleanup(runStatus);
  }
}

run();

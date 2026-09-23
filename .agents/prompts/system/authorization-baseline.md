Using the approved SYSTEM BASELINE, redesign the authoritative authorization model.

DO NOT IMPLEMENT CODE YET.

Objectives:

1. Define canonical actors/roles.

2. Map thesis roles to backend roles.

3. Explicitly determine whether:
   - Võ sư
   - Huấn luyện viên
   - Võ sinh
   - Phụ huynh
   - Admin

are distinct authorization roles or domain/persona concepts.

4. Produce a complete permission matrix.

Permission actions:
- V = View
- C = Create
- E = Edit
- D = Delete
- A = Approve
- P = Process
- optionally R = Register where necessary

5. Check every permission against real business meaning.

6. Check for privilege escalation.

7. Check for ownership rules.

8. Define:
   - role-level authorization
   - object ownership
   - parent-child authorization
   - instructor-class authorization
   - admin-only operations
   - financial authorization

9. Compare the proposed matrix against:
   - current NestJS guards
   - @Roles()
   - student ownership guard
   - invoice/payment authorization
   - exam authorization

10. Produce:

ROLE_MODEL.md
or an equivalent authoritative section in docs/PLAN.md.

IMPORTANT:
Do not implement the new authorization model during this task.

The output must be a decision document that future implementation must follow.
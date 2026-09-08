# FEG Hackathon 2026 submission requirements

Source: [`FEG Hackathon 2026 Repository Structure and Submission Guidelines.docx`](../FEG%20Hackathon%202026%20Repository%20Structure%20and%20Submission%20Guidelines.docx)

This note records the actionable requirements from the organiser-provided technical submission guide. The DOCX remains the authoritative source if this summary differs.

## Repository and freeze requirements

- Keep the submission in a private, team-controlled repository through the end of judging.
- Grant the designated T-Hub/FEG reviewer accounts read access without transferring ownership.
- Submit an identifiable commit/version.
- Do not materially change the submission after the deadline unless organisers approve a correction.
- Ensure a technically competent reviewer can clone, configure, run, and validate the submission without undocumented assistance.

## Mandatory submission content

- Complete reviewer-oriented `README.md`.
- Working source/prototype.
- `docs/impact-case.md` covering D3 impact and cost-value analysis.
- `docs/compliance-note.md` covering D4 requirements and implementation choices.
- `docs/architecture.md` describing components, data flows, dependencies, and deployment assumptions.
- `docs/dependencies.md` disclosing material libraries, APIs/SDKs, models, datasets, templates, and licences/permissions.
- Team members, Team Lead, and ownership information.
- AI/code-assistance disclosure where materially applicable.
- Demo video, screenshots, or presentation material where required.
- Submission form/email with repository link and required declarations.

## README minimum content

The final README must include:

1. Team name, challenge, and solution title.
2. Problem statement.
3. Solution overview and key innovation.
4. Key features and user journey.
5. Technology stack.
6. System requirements and prerequisites.
7. Installation and setup.
8. Environment/configuration instructions.
9. How to run the prototype.
10. How to test and validate it.
11. Demo flow.
12. Known limitations, assumptions, and future work.
13. Links to architecture, impact case, compliance note, and dependency disclosure.

## Security and confidentiality

- Never commit credentials, secrets, tokens, real customer/player data, confidential challenge information, or sensitive access details.
- Keep `.env` ignored and provide only non-secret configuration templates.
- Do not share repository credentials or bypass security controls.
- Do not put restricted hackathon resources into public or third-party AI systems without written approval.
- Report suspected compromise or leakage immediately.
- Use third-party software and data only when authorised; comply with licensing and redistribution terms.

These requirements reinforce this repository's existing rule that raw HARs, player-level datasets, provider bundles, media, credentials, and private evidence remain outside Git.

## Current gap checklist

As of this note, the following must be completed or confirmed before submission:

- [ ] Designated T-Hub/FEG reviewer access granted and tested.
- [ ] README expanded to include every required reviewer section.
- [ ] `docs/impact-case.md` completed.
- [ ] `docs/compliance-note.md` completed.
- [ ] `docs/architecture.md` completed.
- [ ] `docs/dependencies.md` completed with licences and permissions.
- [ ] AI/code-assistance disclosure completed.
- [ ] Team members, Team Lead, and ownership documented.
- [ ] Required demo video/screenshots/deck added or linked.
- [ ] Clean-clone setup and core demo flow reproduced from the README.
- [ ] Repository-wide secret and prohibited-data review completed.
- [ ] Final submission commit hash recorded.
- [ ] Submission form/email completed.

## Final pre-submission procedure

1. Clone the repository into a clean environment.
2. Follow the README exactly.
3. Run the complete verification suite and core demo.
4. Confirm all dependencies and configuration are declared.
5. Scan for accidental secrets and prohibited/confidential data.
6. Confirm all mandatory documents and demo artifacts exist.
7. Test reviewer access.
8. Record the final commit hash and retain an internal copy of the frozen state.

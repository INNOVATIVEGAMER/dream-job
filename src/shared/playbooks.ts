import type { Portal } from './types'

/**
 * Each portal's playbook: the short notes Claude gets beyond what the
 * portal's own tools do. Kept short on purpose; the tools carry the rest.
 * Written from each portal's live pages, and updated when a page changes.
 */
export const PLAYBOOKS: Record<Portal, string[]> = {
  linkedin: [
    'Use search_jobs and read_job rather than reading pages: they answer each posting with its job id, and search_jobs already leaves out what the user has seen.',
    'Search is LinkedIn\'s AI search: it takes role, work mode and place as plain words, so search_jobs runs one role, one mode and one place at a time.',
    'Cards show pay only when the employer gives it. "Viewed" means the user opened it before, not that they applied.',
    'A posting\'s company size sits under About the company; read_job turns it into the stage bucket.',
    'A posting without Easy Apply has "Apply on company website". read_job gives that link: open it with open_page in the same tab and carry on there with the general tools and submit_form.',
    'Easy Apply is a form of several pages ("1/5 pages"): contact info filled from the LinkedIn profile, the resume, questions, then a review page. Fill each with easy_apply_fill and send from the review page with easy_apply_submit.',
    'Contact info comes filled from the LinkedIn profile. Keep it unless a saved answer says otherwise.',
    'An Easy Apply question LinkedIn marks with * is required, and Next shows an error until it is answered.',
    'Closing the Easy Apply form asks whether to save it: the app discards it.',
    'A company\'s People page lists who works there, filtered by keywords; find_people reads it. Someone showing Follow can still be sent a request.',
    'A connection request goes through LinkedIn\'s "Add a note to your invitation?" dialog; send_blank_request always picks Send without a note.',
    'When LinkedIn says the invitation limit is reached, stop sending and finish.',
    'Your connections list runs newest first, each with the date they connected: list_new_connections reads it back to the oldest pending request.',
    'The referral message goes from the person\'s profile, through Message. The app types the approved wording, checks it word for word, attaches the resume, and sends.',
  ],
  wellfound: [
    'search_jobs reads the job search saved on the user\'s Wellfound account: the roles, places and pay are set on Wellfound, and the app only sorts it newest first.',
    'Results group jobs by company. Each line carries the company\'s headcount and stage, the places, pay and equity ("₹10L – ₹20L" is 10 to 20 lakh a year), and when it was posted.',
    'A posting\'s link needs its full /jobs/<id>-<slug> path: the id alone is not found.',
    'Wellfound hides postings that do not take applications from the user\'s location, so place is rarely a reason to discard.',
    'The application form shows the posting\'s facts first: where it hires remotely, visa sponsorship, relocation, experience. Check them before writing the note.',
    'Applying sends a note to the company ("What interests you about working for this company?"). The note is a written answer, so the user sees it before it goes.',
  ],
  instahyre: [
    'list_matches reads the jobs Instahyre recommends for the user\'s Instahyre profile, at most a page of them. Instahyre picks them; the app does not search.',
    'Instahyre shows no posting dates and rarely pay: neither is a reason to discard.',
    'A posting\'s page gives the experience asked ("4-8 Years"), company facts with headcount, skills and the description.',
    'Applying is one step and sends the user\'s Instahyre profile: there is nothing to write.',
  ],
}

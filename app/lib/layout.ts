// The one page gutter of the app.
//
// Every full-page view — the top navigation, the rally lists, the rally
// dashboard with its four tabs, the stage and card pages — is laid out in this
// container, so the content keeps the same left and right edge wherever an
// official is: switching a tab or opening a stage never re-flows the page from
// a reading column to the window and back.
//
// It is wide on purpose. The pages that carry this app's real work are grids —
// a controlekaart is four columns of 30 rows, the WPT overview is one row per
// crew running the whole rally left to right — and they need the room. The
// grids that outgrow even this scroll inside themselves (see
// `RallyTimesPanel`), which is what keeps the page itself from scrolling
// sideways.
//
// Forms are the deliberate exception: a rally's details, an account, a login
// are a column of fields and stay narrow in their own `max-w-*`.
export const PAGE_CONTAINER = 'mx-auto w-full max-w-[1700px] px-4 sm:px-6 lg:px-8';

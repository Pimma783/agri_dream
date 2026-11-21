---
inclusion: always
---
# AgriCarbon Match AI

Help smallholder farmers sell rice, maize, and sugarcane residues instead of burning them. Farmers report available biomass in LINE, find suitable biomass buyers, and see estimated net income. Biomass plants are the buyer side of the marketplace.

For the 21 Nov Bootcamp, the team will build F3, the Smart Matching Engine. The demo uses sample data to show farmers which buyers accept their biomass and are within 80 km, with simulated prices per ton and transport distances.

- Pilot in Uttaradit, Nakhon Sawan, and Kamphaeng Phet.
- Use LINE Messaging API and LIFF as the primary channel. Native apps are out of scope.
- Use icon-first controls with labels of at most five words. Keep each decision on one screen and support local units such as เกวียน and ไร่.
- Design for intermittent connectivity with an offline-tolerant PWA and sync when connectivity returns.
- Show AI estimates separately from actual buyer prices.
- Keep access free for farmers. Revenue from plants and carbon markets is a business hypothesis.
- Follow the 12-month MVP scope and decision log in `docs/submission.md`. F1–F4 are must-haves; F5 is later optimization.
- Limit transport distance to 80 km. When implementing F5, group 3–5 farmers within 10 km.
- Exclude payments and carbon credit trading from the MVP. The proposed 75:25 carbon split is unconfirmed.
- Present modeled income and savings as estimates. Do not promise buyer participation, verified carbon credits, or proceeds.

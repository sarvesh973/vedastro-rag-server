# Privacy Policy

**Moksha**
Last updated: 7 May 2026

## 1. Who we are

Moksha ("we", "us", "the app") is an AI-powered Vedic astrology application that provides personalized predictions, palm reading, kundli analysis, and AI guru chat based on classical Vedic texts (Brihat Parashara Hora Shastra, Phaladeepika, Brighu Sanhita).

This Privacy Policy explains what personal information we collect, how we use it, and your rights as a user. We are committed to compliance with the Digital Personal Data Protection Act, 2023 (DPDP Act), Information Technology Act 2000, and Google Play's data-safety requirements.

For any questions: **Piyushtiwari260309@gmail.com / sarry1254@gmail.com**

## 2. Information we collect

### 2.1 Account information
When you create an account we collect:
- **Name** (full name as you enter it)
- **Email address** (Google sign-in or email/password)
- **Phone number** (for OTP login, optional)
- **Profile photo** (only if you sign in with Google)

### 2.2 Astrological information
To generate predictions we collect:
- **Date of birth** (required)
- **Time of birth** (optional but improves accuracy)
- **Place of birth** (city / town)

You may add additional family profiles with the same details for relatives.

### 2.3 Usage information
- **Chat history** with the AI guru
- **Palm reading photos** you upload (used only for the analysis, deleted after 7 days unless you explicitly save them)
- **Horoscope views** (which periods you opened)
- **App usage analytics** (which screens you open, anonymous)

### 2.4 Payment information
For subscriptions we share with our payment processor (Razorpay) the following:
- Email, phone, name (to create the customer record)
- Subscription plan you chose

**We DO NOT see, store, or process your card / UPI / bank details.** Razorpay handles all payment-method data on its PCI-DSS-certified servers.

### 2.5 Device information
- Device model, OS version, app version (for crash reporting)
- Anonymous app-install ID (for analytics)

We do NOT collect: precise location, contacts, SMS, browser history, photos beyond what you upload, microphone, or any biometric data.

## 3. How we use your information

| Purpose | Data used |
|---------|-----------|
| Generate predictions, horoscopes, palm reading | DOB, TOB, place, palm photo |
| Personalize AI guru responses | Profile + recent chat history |
| Process subscription payments | Email, phone, plan |
| Authenticate your account | Email or phone + Firebase token |
| Send service notifications (auto-debit reminder, trial ending) | Email + phone |
| Diagnose and fix crashes | Anonymous device + crash logs |
| Improve our prompts and AI quality | Anonymized chat samples |

We **NEVER**:
- Sell your data
- Show third-party advertisements
- Profile you for ad targeting
- Share data with social networks

## 4. Where your data is stored

- **Profile + chat history:** Firebase Firestore (Google Cloud, Mumbai region — `asia-south1`)
- **Authentication:** Firebase Authentication (Google Cloud)
- **Payments:** Razorpay servers (RBI-licensed payment aggregator, India)
- **AI processing:** Google Gemini API (data not retained beyond the request)
- **Backend server:** Render.com (Singapore)

Data stays within India / Asia-Pacific region wherever possible. International transfer (e.g. to Gemini in US) is limited to the question text and necessary context for generating an answer.

## 5. Who we share data with

We share the minimum necessary information with these processors:

| Processor | Why | What |
|-----------|-----|------|
| Google Firebase | Auth + database | Email, profile, chat |
| Google Gemini | AI predictions | Question + birth chart context |
| Razorpay | Payment processing | Email, phone, name, plan |
| Render.com | Server hosting | All API requests |

We do **NOT** share data with:
- Advertisers
- Data brokers
- Marketing companies
- Other astrology apps or competitors

## 6. Your rights

Under the DPDP Act 2023 and applicable laws, you have the right to:

- **Access** your personal data — view your profile in app, request a full export by emailing us
- **Correct** inaccurate data — edit your profile in Settings
- **Delete** your account — Settings → Delete Account (immediate and permanent)
- **Withdraw consent** — uninstall the app and request deletion
- **Object** to processing — email us
- **Portability** — request a JSON export of your data
- **Lodge a complaint** with the Data Protection Board of India

To exercise any of these, email **Piyushtiwari260309@gmail.com / sarry1254@gmail.com** with the subject line "Data request". We respond within 7 days.

## 7. Account deletion

You can delete your account at any time from **Settings → Delete Account**. Deletion is immediate and removes:
- Your profile (name, DOB, place, time)
- All family profiles you added
- Chat history
- Palm reading history
- Subscription state (active subscriptions are also cancelled)
- Authentication record

**Cannot be undone.** You'll need to start fresh if you want to use the app again.

We retain anonymized financial transaction records for 7 years to comply with India's Income Tax Act / GST regulations, but these contain no personal information. Note: payments themselves are non-refundable per the Terms of Service.

## 8. Children's privacy

Moksha is not intended for users under 13. We do not knowingly collect data from anyone under 13. Users between 13-18 should use the app with parental consent, especially before subscribing to any paid plan.

If you believe a child has provided us data, email us and we'll delete it.

## 9. Security

- All API communication uses HTTPS / TLS 1.2+
- Firestore data is encrypted at rest by Google
- Razorpay handles payments with PCI-DSS Level 1 compliance
- Passwords are never stored — Firebase handles auth
- Admin access to user data requires multi-factor authentication

In case of a data breach affecting your information, we will notify you within 72 hours via email and the in-app notification.

## 10. Cookies and tracking

The mobile app does not use cookies. We use one anonymous "install ID" assigned by Firebase to distinguish devices for crash reporting — this cannot be linked back to your identity by anyone outside our team.

## 11. Third-party services in detail

By using Moksha you agree that the following third parties also process your data, each governed by their own privacy policy:

- **Google Firebase**: https://firebase.google.com/support/privacy
- **Google Gemini**: https://policies.google.com/privacy
- **Razorpay**: https://razorpay.com/privacy/
- **Render**: https://render.com/privacy

## 12. Changes to this policy

We may update this Privacy Policy as features change. Material changes will be announced in-app and by email at least 30 days before taking effect. The "Last updated" date at the top reflects the most recent change.

## 13. Contact

**Email:** Piyushtiwari260309@gmail.com / sarry1254@gmail.com
**Operator:** [Your registered name / business entity]
**Address:** [Your registered address]

---

*This policy is governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts in [Your city], India.*

# PaymentServer

A Node.js backend server for handling PayPal payments and Unity game entitlements, integrated with Firebase Authentication and Firestore.

## What it does

Handles the full payment flow for a Unity game client — user registration and login via Firebase, PayPal order creation and capture, and automatic entitlement granting after a successful purchase.

## Tech Stack

- **Runtime:** Node.js
- **Framework:** Express
- **Authentication:** Firebase Admin SDK
- **Database:** Firestore
- **Payments:** PayPal REST API
- **Session:** express-session

## API Endpoints

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | `/register` | Register a new user in Firebase and create a client | No |
| POST | `/login` | Login with email and password | No |
| POST | `/create-paypal-payment` | Create a PayPal order | Yes |
| GET | `/check-order-status` | Check the status of a PayPal order | Yes |
| POST | `/capture-paypal-payment` | Capture payment and grant entitlements | Yes |

## Getting Started

### Prerequisites

- Node.js 18+
- Firebase project with Firestore and Authentication enabled
- PayPal developer account with sandbox credentials

### Environment Variables

```env
APP_ID=
APP_SECRET=
FIREBASE_API_KEY=
```

### Installation

```bash
git clone https://github.com/SorenUPP/PaymentServer.git
cd PaymentServer
npm install
```

### Run

```bash
npm start
```


## License

MIT

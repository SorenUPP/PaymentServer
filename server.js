const express = require("express");
const cors = require("cors");
const fetch = require("node-fetch");
require("dotenv").config();
const admin = require('firebase-admin');
const fs = require("fs");
const session = require("express-session");

const serviceAccount = JSON.parse(fs.readFileSync("./firebaseServiceAccount.json", "utf8"));

const app = express();
const PORT = 3000;

// PayPal Credentials
const PAYPAL_CLIENT =
  "Afllyny7MKV2a-1DmMB5lElisazAHM67Xkn-GZ5rvVUEFouTIEu7GEva8tHRprkm2FMPOcygKvxBVTeX";
const PAYPAL_SECRET =
  "ENMZpogUlrsLBzNgRzteNQYNTkCy7V_H_kKt9_t1m2BrhrI3uzRAzIfV3PhxVGTMIJlaJBFtFwAOlGAy";
const PAYPAL_API = "https://api-m.sandbox.paypal.com";



admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

app.use(cors());
app.use(express.json());
app.use(session({
  secret: "superSecretKey",
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false }
}));


// PayPal Access Token so we are authorized to make create and capture requests to paypal api:s
async function generateAccessToken() {
  const auth = Buffer.from(`${PAYPAL_CLIENT}:${PAYPAL_SECRET}`).toString(
    "base64",
  );
  const response = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const data = await response.json();
  return data.access_token;
}


// == Registering new clients
app.post("/register", async (req, res) => {
  const { email, password } = req.body;
  try {
    // 1️⃣ Firebase registration
    const user = await admin.auth().createUser({ email, password });

    const APP_ID = process.env.APP_ID;
    const APP_SECRET = process.env.APP_SECRET;
    const authHeader =
      "Basic " + Buffer.from(`${APP_ID}:${APP_SECRET}`).toString("base64");

    const registerResponse = await fetch('https://api.reactionalmusic.com/v1/auth/clients/register', {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ appId: APP_ID, clientType: "b2c" }),
    });

    const registerData = await registerResponse.json();
     
   const db = admin.firestore();

   await db.collection("clients").doc(user.uid).set({
    CLIENT_ID: registerData.id,
    CLIENT_SECRET: registerData.secret
   });

    res.status(201).json({
      uid: user.uid,
      email: user.email,
      clientId: registerData.id,
      clientSecret: registerData.secret
    });


  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// == Login section
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_WEB_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          password,
          returnSecureToken: true
        })
      }
    );

    const data = await response.json();

    if (data.error) {
      return res.status(400).json({ error: data.error.message });
    }


    res.json({
      message: "Logged in successfully!",
      token: data.idToken,
      user: {
        uid: data.localId,
        email: data.email
      }
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// == Login check
async function requireLogin(req, res, next) {
  
  try {
  const authHeader = req.headers["authorization"];
  
  if (!authHeader) {
    return res.status(401).json({ error: "Invalid Authorization"});
  }

  const token = authHeader.split(" ")[1];
  const decodedToken = await admin.auth().verifyIdToken(token);

  res.locals.user = decodedToken;
  next();
} catch (error) {
  console.error("auth has failed: ", error);
  return res.status(401).json({ error: "Inavlid token"}); 
}
}

// == PAYPAL SECTION ==
app.post("/create-paypal-payment", requireLogin, async (req, res) => {
  const { items, currency } = req.body;

  if (!items || items.length === 0 || !currency) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    console.log("Creating payment order for user: ", res.locals.user.uid);
    const accessToken = await generateAccessToken();

    const purchase_units = [
      {
        amount: {
          currency_code: currency,
          value: items.reduce((sum, i) => sum + i.price, 0).toFixed(2),
        },
        description: "Unity Purchase",
      },
    ];

    const response = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units,
      }),
    });

    const paypalData = await response.json();

    const approveLink = paypalData.links?.find(
      (link) => link.rel === "approve",
    );

    res.status(200).json({
      id: paypalData.id,
      approveUrl: approveLink ? approveLink.href : null,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create PayPal payment" });
  }
});

app.get("/check-order-status", requireLogin, async (req, res) => {
  const orderId = req.query.orderId;

  if (!orderId) {
    return res.status(400).json({ error: "Missing orderId" });
  }

  try {
    const accessToken = await generateAccessToken();
    const response = await fetch(
      `${PAYPAL_API}/v2/checkout/orders/${orderId}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      },
    );

    const paypalData = await response.json();
    res.status(200).json({ status: paypalData.status, id: paypalData.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch order status" });
  }
});

app.post("/capture-paypal-payment", requireLogin, async (req, res) => {
  console.log("capture has been initiated");
  const { orderId, clientId, currency, items } = req.body;

  if (!orderId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const accessToken = await generateAccessToken();

  const captureResponse = await fetch(
    `${PAYPAL_API}/v2/checkout/orders/${orderId}/capture`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  const paypalData = await captureResponse.json();
  console.log("Payment has been confirmed!");

const db = admin.firestore();
const docSnap = await db.collection("clients").doc(req.user.uid).get(); 

const { CLIENT_ID, CLIENT_SECRET } = docSnap.data();
  //Entitlement section
  const entitlementAuth =
    "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

  const entitlementPayload = {
    currency,
    items,
  };

  const entitlementResponse = await fetch(
    `https://api.reactionalmusic.com/v1/customer/clients/${CLIENT_ID}/entitlements`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: entitlementAuth,
      },
      body: JSON.stringify(entitlementPayload),
    },
  );

  const entitlementData = await entitlementResponse.json();
  console.log("Entitlements has been granted: ", entitlementData);

  //Returning the result to unity
  return res.status(200).json({
    message: "Payment has been recieved and entitlements has been granted!",
    orderId,
    paypalData,
    user: req.user
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});




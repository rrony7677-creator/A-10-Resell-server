const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();
const express = require("express");
const app = express();
const port = 5000;
const cors = require("cors");
app.use(
  cors({
    origin: "*",
  }),
);
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb"); // ObjectId যুক্ত হলো

app.get("/", (req, res) => {
  res.send("Hello World!");
});

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const { createRemoteJWKSet, jwtVerify } = await import("jose");
    // await client.connect();

    const database = client.db("resell_db");
    const userCollection = database.collection("user");
    const productsCollection = database.collection("products");
    const ordersCollection = database.collection("orders");
    const paymentsCollection = database.collection("payments");
    const wishlistCollection = database.collection("wishlist");

    // const JWKS = createRemoteJWKSet(
    //   new URL(
    //     `${process.env.NEXT_PUBLIC_BETTER_AUTH_URL || "http://localhost:3000"}/api/auth/jwks`,
    //   ),
    // );

    const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`));

    const verifyToken = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).send({ message: "Unauthorized: no token provided" });
      }
      try {
        const token = authHeader.split(" ")[1];
        const { payload } = await jwtVerify(token, JWKS);
        req.decoded = payload;
        next();
      } catch (err) {
        return res.status(403).send({ message: "Forbidden: invalid or expired token" });
      }
    };

    const verifyRole =
      (...allowedRoles) =>
        async (req, res, next) => {
          try {
            const currentUser = await userCollection.findOne({ _id: new ObjectId(req.decoded.sub) });
            if (!currentUser || !allowedRoles.includes(currentUser.role)) {
              return res.status(403).send({ message: "Forbidden: insufficient role" });
            }
            req.currentUser = currentUser;
            next();
          } catch (err) {
            return res.status(403).send({ message: "Forbidden" });
          }
        };

    // GET all products (filter দিয়ে) —
    // app.get('/api/products', async (req, res) => {
    //   const query = {};
    //   if (req.query.sellerId) {
    //     query.sellerId = req.query.sellerId;
    //   }
    //   if (req.query.status) {
    //     query.status = req.query.status;
    //   }
    //   const cursor = productsCollection.find(query);
    //   const result = await cursor.toArray();
    //   res.send(result);
    // });

    app.get("/api/products", async (req, res) => {
      const { sellerId, status, search, category, condition, sort, page, limit, all } = req.query;
      const query = {};

      if (sellerId) {
        query.sellerId = sellerId;
        if (status) query.status = status;
      } else if (all === "true") {
        if (status) query.status = status; // admin — filter না দিলে সব status দেখাবে
      } else {
        query.status = status || "available"; // public browsing
      }

      if (category) query.category = category;
      if (condition) query.condition = condition;
      if (search) {
        query.$or = [
          { title: { $regex: search, $options: "i" } },
          { category: { $regex: search, $options: "i" } },
        ];
      }

      let sortOption = { _id: -1 };
      if (sort === "price_asc") sortOption = { price: 1 };
      if (sort === "price_desc") sortOption = { price: -1 };

      if (page && limit) {
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const skip = (pageNum - 1) * limitNum;
        const totalCount = await productsCollection.countDocuments(query);
        const result = await productsCollection
          .find(query)
          .sort(sortOption)
          .skip(skip)
          .limit(limitNum)
          .toArray();
        return res.send({
          products: result,
          totalCount,
          totalPages: Math.ceil(totalCount / limitNum),
          currentPage: pageNum,
        });
      }

      const cursor = productsCollection.find(query).sort(sortOption);
      const result = await cursor.toArray();
      res.send(result);
    });

    // ✅ নতুন: একটা single product বের করার জন্য (Edit page এ লাগবে)
    app.get("/api/products/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.findOne(query);
      res.send(result);
    });

    app.post("/api/products", verifyToken, verifyRole("seller"), async (req, res) => {
      const product = req.body;
      product.sellerId = req.currentUser._id.toString();
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

    app.patch("/api/products/:id/stock", verifyToken, async (req, res) => {
      const id = req.params.id;
      const { decrementBy } = req.body;
      const product = await productsCollection.findOne({ _id: new ObjectId(id) });
      if (!product) return res.status(404).send({ message: "Product not found" });
      const newStock = Math.max(0, (product.stockQuantity || 0) - (decrementBy || 0));
      const result = await productsCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { stockQuantity: newStock } },
      );
      res.send(result);
    });

    app.patch("/api/products/:id", verifyToken, verifyRole("seller", "admin"), async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = { $set: req.body };
      const result = await productsCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    app.delete(
      "/api/products/:id",
      verifyToken,
      verifyRole("seller", "admin"),
      async (req, res) => {
        const id = req.params.id;
        const query = { _id: new ObjectId(id) };
        const result = await productsCollection.deleteOne(query);
        res.send(result);
      },
    );

    // Orders Page
    // GET orders — seller এর incoming orders, status দিয়ে filter করা যাবে
    // app.get('/api/orders', async (req, res) => {
    //   const query = {};
    //   if (req.query.sellerId) {
    //     query.sellerId = req.query.sellerId;
    //   }
    //   if (req.query.status) {
    //     query.orderStatus = req.query.status;
    //   }
    //   const cursor = ordersCollection.find(query).sort({ createdAt: -1 });
    //   const result = await cursor.toArray();
    //   res.send(result);
    // });

    // order page

    app.get("/api/orders", async (req, res) => {
      const { sellerId, buyerId, status } = req.query;
      const query = {};
      if (sellerId) query.sellerId = sellerId;
      if (buyerId) query["buyerInfo.userId"] = buyerId;
      if (status) query.orderStatus = status;
      const cursor = ordersCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    // GET single order (details view এর জন্য লাগলে)
    app.get("/api/orders/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await ordersCollection.findOne(query);
      res.send(result);
    });

    app.post("/api/orders", verifyToken, verifyRole("buyer"), async (req, res) => {
      const order = req.body;
      order.createdAt = new Date();
      const result = await ordersCollection.insertOne(order);
      res.send(result);
    });

    // PATCH order status — Accept, Reject, Update delivery status সব এটা দিয়েই হবে
    app.patch(
      "/api/orders/:id/status",
      verifyToken,
      verifyRole("seller", "admin"),
      async (req, res) => {
        const id = req.params.id;
        const { status } = req.body;
        const filter = { _id: new ObjectId(id) };
        const updatedDoc = { $set: { orderStatus: status, updatedAt: new Date() } };
        const result = await ordersCollection.updateOne(filter, updatedDoc);
        res.send(result);
      },
    );

    // payment system

    // app.get('/api/payments', async (req, res) => {
    //   const { buyerId } = req.query;
    //   const query = buyerId ? { buyerId } : {};
    //   const cursor = paymentsCollection.find(query).sort({ createdAt: -1 });
    //   const result = await cursor.toArray();
    //   res.send(result);
    // });

    app.get("/api/payments", async (req, res) => {
      const { buyerId, transactionCheck } = req.query;
      const query = {};
      if (buyerId) query.buyerId = buyerId;
      if (transactionCheck) query.transactionId = transactionCheck;
      const cursor = paymentsCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/api/payments", async (req, res) => {
      const payment = req.body;
      payment.createdAt = new Date();
      const result = await paymentsCollection.insertOne(payment);
      res.send(result);
    });

    //Wishlist
    app.get("/api/wishlist", async (req, res) => {
      const { buyerId } = req.query;
      const query = buyerId ? { buyerId } : {};
      const cursor = wishlistCollection.find(query).sort({ createdAt: -1 });
      const result = await cursor.toArray();
      res.send(result);
    });

    app.post("/api/wishlist", verifyToken, verifyRole("buyer"), async (req, res) => {
      const { buyerId, productId } = req.body;
      const existing = await wishlistCollection.findOne({ buyerId, productId });
      if (existing) return res.send({ alreadyExists: true, _id: existing._id });

      const item = { ...req.body, createdAt: new Date() };
      const result = await wishlistCollection.insertOne(item);
      res.send(result);
    });
    app.delete("/api/wishlist", verifyToken, verifyRole("buyer"), async (req, res) => {
      const { buyerId, productId } = req.query;
      const result = await wishlistCollection.deleteOne({ buyerId, productId });
      res.send(result);
    });

    // Admin: সব stats
    app.get("/api/admin/stats", verifyToken, verifyRole("admin"), async (req, res) => {
      const totalUsers = await userCollection.countDocuments();
      const totalProducts = await productsCollection.countDocuments();
      const totalOrders = await ordersCollection.countDocuments();
      res.send({ totalUsers, totalProducts, totalOrders });
    });

    // Admin: সব user
    app.get("/api/admin/users", verifyToken, verifyRole("admin"), async (req, res) => {
      const result = await userCollection.find({}).toArray();
      res.send(result);
    });

    app.patch("/api/admin/users/:id/status", verifyToken, verifyRole("admin"), async (req, res) => {
      const { status } = req.body;
      const result = await userCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { status } },
      );
      res.send(result);
    });

    app.delete("/api/admin/users/:id", verifyToken, verifyRole("admin"), async (req, res) => {
      const result = await userCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    // Public

    app.get("/api/stats/public", async (req, res) => {
      const totalProducts = await productsCollection.countDocuments({ status: "available" });
      const totalSellers = await userCollection.countDocuments({ role: "seller" });
      const totalBuyers = await userCollection.countDocuments({ role: "buyer" });
      const completedOrders = await ordersCollection.countDocuments({ orderStatus: "delivered" });
      res.send({ totalProducts, totalSellers, totalBuyers, completedOrders });
    });

    // await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});

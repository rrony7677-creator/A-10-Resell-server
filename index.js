const express = require('express');
const app = express();
const port = 5000;
const cors = require('cors');
require('dotenv').config();
app.use(cors());
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb'); // ObjectId যুক্ত হলো

app.get('/', (req, res) => {
  res.send('Hello World!');
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
    await client.connect();

    const database = client.db("resell_db");
    const productsCollection = database.collection("products");
    const ordersCollection = database.collection("orders");
    const paymentsCollection = database.collection("payments");


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

    app.get('/api/products', async (req, res) => {
  const { sellerId, status, search, category, condition, sort, page, limit } = req.query;
  const query = {};

  if (sellerId) {
    // seller এর নিজের My Products page এর জন্য — সব status দেখাবে
    query.sellerId = sellerId;
    if (status) query.status = status;
  } else {
    // public browsing — শুধু approved product দেখাবে
    query.status = status || "available";
  }

  if (category) query.category = category;
  if (condition) query.condition = condition;

  if (search) {
    query.$or = [
      { title: { $regex: search, $options: "i" } },
      { category: { $regex: search, $options: "i" } },
    ];
  }

  let sortOption = { _id: -1 }; // newest first
  if (sort === "price_asc") sortOption = { price: 1 };
  if (sort === "price_desc") sortOption = { price: -1 };

  // page ও limit দিলেই paginated response, না হলে আগের মতোই plain array (My Products page এ কিছু বদলাতে হবে না)
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
    app.get('/api/products/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.findOne(query);
      res.send(result);
    });

    app.post('/api/products', async (req, res) => {
      const product = req.body;
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });

    // ✅ নতুন: Update করার জন্য
    app.patch('/api/products/:id', async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const updatedDoc = { $set: req.body };
      const result = await productsCollection.updateOne(filter, updatedDoc);
      res.send(result);
    });

    // ✅ নতুন: Delete করার জন্য
    app.delete('/api/products/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await productsCollection.deleteOne(query);
      res.send(result);
    });

    // Orders Page
    // GET orders — seller এর incoming orders, status দিয়ে filter করা যাবে
app.get('/api/orders', async (req, res) => {
  const query = {};
  if (req.query.sellerId) {
    query.sellerId = req.query.sellerId;
  }
  if (req.query.status) {
    query.orderStatus = req.query.status;
  }
  const cursor = ordersCollection.find(query).sort({ createdAt: -1 });
  const result = await cursor.toArray();
  res.send(result);
});

// GET single order (details view এর জন্য লাগলে)
app.get('/api/orders/:id', async (req, res) => {
  const id = req.params.id;
  const query = { _id: new ObjectId(id) };
  const result = await ordersCollection.findOne(query);
  res.send(result);
});

// PATCH order status — Accept, Reject, Update delivery status সব এটা দিয়েই হবে
app.patch('/api/orders/:id/status', async (req, res) => {
  const id = req.params.id;
  const { status } = req.body;
  const filter = { _id: new ObjectId(id) };
  const updatedDoc = { $set: { orderStatus: status, updatedAt: new Date() } };
  const result = await ordersCollection.updateOne(filter, updatedDoc);
  res.send(result);
});

// payment system

app.post('/api/payments', async (req, res) => {
  const payment = req.body;
  payment.createdAt = new Date();
  const result = await paymentsCollection.insertOne(payment);
  res.send(result);
});

    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
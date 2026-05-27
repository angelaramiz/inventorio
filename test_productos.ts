import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

if (!url || !key) {
  console.error("Missing environment variables!");
  process.exit(1);
}

const supabase = createClient(url, key);

async function checkProductos() {
  try {
    const { data, error } = await supabase.from("productos").select("*").limit(1);
    if (error) {
      console.error("Error fetching from productos table:", error);
    } else {
      console.log("Successfully fetched a record from productos:", data);
      if (data && data.length > 0) {
        console.log("Columns in productos:", Object.keys(data[0]));
      }
    }
  } catch (err: any) {
    console.error("Error executing query:", err.message);
  }
}

checkProductos();

import { RouterProvider } from "react-router-dom";

import { AuthProvider } from "@/app/providers/AuthProvider";
import { AdminPushSync } from "@/components/AdminPushSync";
import { router } from "@/routes/router";

function App() {
  return (
    <AuthProvider>
      <AdminPushSync />
      <RouterProvider router={router} />
    </AuthProvider>
  );
}

export default App;

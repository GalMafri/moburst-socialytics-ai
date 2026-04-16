import { useLocation } from "react-router-dom";
import { useEffect } from "react";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0b0c10] intercept-bg">
      <div className="text-center relative z-10">
        <h1 className="mb-4 text-4xl font-bold text-white">404</h1>
        <p className="mb-4 text-xl text-[#9ca3af]">Oops! Page not found</p>
        <a href="/" className="text-[#b9e045] underline hover:text-[#c5e85c]">
          Return to Home
        </a>
      </div>
    </div>
  );
};

export default NotFound;

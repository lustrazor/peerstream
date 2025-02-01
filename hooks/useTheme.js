import { useState, useEffect } from 'react';

export function useTheme() {
  // Initialize state without accessing localStorage (avoids SSR issues)
  const [isDark, setIsDark] = useState(true);

  // Load theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('theme');
    if (savedTheme === 'light') {
      setIsDark(false);
    }
  }, []);

  // Update localStorage whenever theme changes
  const toggleTheme = () => {
    const newTheme = !isDark;
    setIsDark(newTheme);
    localStorage.setItem('theme', newTheme ? 'dark' : 'light');
  };

  return [isDark, toggleTheme];
} 
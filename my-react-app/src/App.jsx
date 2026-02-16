import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './components/Login';
import Chat from './components/Chat';
import Hub from './components/Hub';
import './App.css';

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/hub" element={<Hub />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
import React from 'react';

const Layout = ({ children }) => {
    return (
        <div>
            <header>
                <h1>My React App</h1>
            </header>
            <main>{children}</main>
            <footer>
                <p>&copy; {new Date().getFullYear()} My React App</p>
            </footer>
        </div>
    );
};

export default Layout;
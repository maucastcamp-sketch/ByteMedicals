-- ByteMedicals + PRAG — tablas de usuarios y conversaciones (MySQL).
--
-- Base de datos: bytemedicals_db.
-- Este archivo es ADITIVO: no toca el
-- catálogo de insumos (bytemedicals_insumos_espaciales.sql).
--
-- Crear la base y las tablas (una vez, desde la carpeta del proyecto):
--   mysql -u root -p < bytemedicals_auth.sql
-- La aplicación también crea la base y las tablas sola al arrancar
-- si el usuario de la base tiene permisos para ello.
--
-- Usuarios: cuentas individuales con rol ('user' | 'admin').
-- Conversaciones y mensajes: memoria conversacional por usuario
-- (Paso 4). Las conversaciones pertenecen a un usuario y nadie más
-- puede leerlas: cada consulta filtra por user_id.

CREATE DATABASE IF NOT EXISTS bytemedicals_db
    DEFAULT CHARACTER SET utf8mb4
    DEFAULT COLLATE utf8mb4_unicode_ci;

USE bytemedicals_db;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(120) NOT NULL UNIQUE,
    password_hash CHAR(128) NOT NULL,
    salt CHAR(32) NOT NULL,
    role ENUM('user', 'admin') NOT NULL DEFAULT 'user',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS conversations (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(200) NOT NULL DEFAULT 'Nueva conversación',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    conversation_id INT NOT NULL,
    role ENUM('user', 'assistant') NOT NULL,
    content TEXT NOT NULL,
    sources TEXT NOT NULL DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- (Ejecutar una vez sobre una base limpia. La aplicación también
-- crea estas tablas sola al arrancar; los índices duplicados en
-- rearranques los ignora el código.)
CREATE INDEX idx_conversations_user
    ON conversations(user_id);
CREATE INDEX idx_messages_conversation
    ON messages(conversation_id);
